/** Disposable qualification shop: a real HTTP API with persistence, not a UI-only mock.
 *
 * Prices and stock come from the server. The client may send a price; it is ignored.
 * Synthetic seed data only, per docs/QUALIFICATION.md: rice 5500, soap 2500 centavos.
 *
 * Defects are injectable through SHOP_DEFECT so the protected probes have something real to
 * catch. They are public mutation self-tests, never held-out proof.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, 'public');
const MAXIMUM_QUANTITY = 99;
const DEFECT = process.env['SHOP_DEFECT'] ?? 'none';

const PRODUCTS = [
  { product_id: 'rice', name: 'Rice 1kg', price_centavos: 5500, stock: 40 },
  { product_id: 'soap', name: 'Bath soap', price_centavos: 2500, stock: 60 },
];

const db = new DatabaseSync(process.env['SHOP_DB'] ?? ':memory:');
db.exec(`PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL, customer_mobile TEXT NOT NULL,
  total_centavos INTEGER NOT NULL, items_json TEXT NOT NULL, created_at TEXT NOT NULL
);`);

/** Accepts 09 + nine digits or +639 + nine digits; normalises to the +639 form. */
export function normaliseMobile(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/[\s-]/g, '');
  if (/^09\d{9}$/.test(trimmed)) return `+639${trimmed.slice(2)}`;
  if (/^\+639\d{9}$/.test(trimmed)) return trimmed;
  return null;
}

/** Server-side pricing. A client-supplied price never reaches the total. */
export function priceOrder(items) {
  const errors = [];
  let total = 0;
  const priced = [];
  if (!Array.isArray(items) || items.length === 0) return { errors: ['EMPTY_CART'], total_centavos: 0, items: [] };
  for (const [index, item] of items.entries()) {
    const product = PRODUCTS.find(entry => entry.product_id === item?.product_id);
    if (!product) { errors.push(`UNKNOWN_PRODUCT:${index}`); continue; }
    const quantity = item?.quantity;
    if (!Number.isSafeInteger(quantity)) { errors.push(`QUANTITY_NOT_INTEGER:${index}`); continue; }
    // The negative-quantity defect removes the lower bound the server must enforce.
    const lowerBoundOk = DEFECT === 'negative-quantity' ? true : quantity >= 1;
    if (!lowerBoundOk) { errors.push(`QUANTITY_TOO_LOW:${index}`); continue; }
    if (quantity > MAXIMUM_QUANTITY) { errors.push(`QUANTITY_ABOVE_MAXIMUM:${index}`); continue; }
    total += product.price_centavos * quantity;
    priced.push({ product_id: product.product_id, quantity, unit_price_centavos: product.price_centavos });
  }
  return { errors, total_centavos: total, items: priced };
}

function send(response, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload), ...headers });
  response.end(payload);
}

function serveStatic(request, response) {
  const requested = request.url === '/' ? '/index.html' : (request.url ?? '/').split('?')[0];
  const file = path.join(PUBLIC, path.normalize(requested).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC) || !existsSync(file)) { send(response, 404, { error: 'NOT_FOUND' }); return; }
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
  let body = readFileSync(file, 'utf8');
  if (file.endsWith('index.html')) body = body.replace('__DEFECT__', DEFECT);
  response.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error('PAYLOAD_TOO_LARGE');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createShop() {
  return createServer(async (request, response) => {
    const url = (request.url ?? '/').split('?')[0];
    try {
      if (request.method === 'GET' && url === '/api/products') {
        send(response, 200, { products: PRODUCTS.map(({ stock: _stock, ...rest }) => rest) });
        return;
      }
      if (request.method === 'GET' && url.startsWith('/api/orders/')) {
        const order_id = url.slice('/api/orders/'.length);
        const row = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(order_id);
        if (!row) { send(response, 404, { error: 'ORDER_NOT_FOUND' }); return; }
        send(response, 200, { order: { ...row, items: JSON.parse(String(row.items_json)) } });
        return;
      }
      if (request.method === 'GET' && url === '/api/orders') {
        const rows = db.prepare('SELECT order_id, total_centavos, created_at FROM orders ORDER BY created_at').all();
        send(response, 200, { orders: rows });
        return;
      }
      if (request.method === 'POST' && url === '/api/orders') {
        const key = request.headers['idempotency-key'];
        if (typeof key !== 'string' || key.length === 0) { send(response, 400, { error: 'IDEMPOTENCY_KEY_REQUIRED' }); return; }
        const body = await readJson(request);
        const priced = priceOrder(body?.items);
        const mobile = normaliseMobile(body?.customer?.mobile);
        const name = typeof body?.customer?.name === 'string' ? body.customer.name.trim() : '';
        const errors = [...priced.errors];
        if (mobile === null) errors.push('MOBILE_INVALID');
        if (name.length === 0) errors.push('NAME_REQUIRED');
        if (errors.length > 0) { send(response, 422, { error: 'INVALID_ORDER', details: errors }); return; }

        const existing = db.prepare('SELECT * FROM orders WHERE idempotency_key = ?').get(key);
        if (existing) {
          send(response, 200, { order: { ...existing, items: JSON.parse(String(existing.items_json)) }, replayed: true });
          return;
        }
        const order_id = `order_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        const created_at = new Date().toISOString();
        db.prepare('INSERT INTO orders (order_id, idempotency_key, customer_name, customer_mobile, total_centavos, items_json, created_at) VALUES (?,?,?,?,?,?,?)')
          .run(order_id, key, name, mobile, priced.total_centavos, JSON.stringify(priced.items), created_at);
        send(response, 201, {
          order: { order_id, customer_name: name, customer_mobile: mobile, total_centavos: priced.total_centavos, items: priced.items, created_at },
          replayed: false,
        });
        return;
      }
      if (request.method === 'GET') { serveStatic(request, response); return; }
      send(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    } catch (error) {
      send(response, 400, { error: 'BAD_REQUEST', message: String(error?.message ?? error) });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env['PORT'] ?? 0);
  createShop().listen(port, '127.0.0.1', function ready() {
    process.stdout.write(JSON.stringify({ url: `http://127.0.0.1:${this.address().port}`, defect: DEFECT }) + '\n');
  });
}
