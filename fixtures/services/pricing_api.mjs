/** A disposable pricing service for documentation qualification.
 *
 * Its published documentation says the quantity parameter is called `qty`. The implementation
 * calls it `quantity`. The point of the fixture is that the documentation is wrong and only
 * running the example finds out.
 */
import { createServer } from 'node:http';

export const SERVICE_VERSION = '2.4.0';
const PRICES = { rice: 4500, soap: 2500 };

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const send = (status, body) => {
    const payload = JSON.stringify(body);
    response.writeHead(status, { 'content-type': 'application/json', 'x-service-version': SERVICE_VERSION });
    response.end(payload);
  };
  if (url.pathname === '/version') return send(200, { version: SERVICE_VERSION });
  if (url.pathname === '/price') {
    const product = url.searchParams.get('product');
    // The implementation reads `quantity`. The documentation says `qty`.
    const raw = url.searchParams.get('quantity');
    if (product === null || !(product in PRICES)) return send(400, { error: 'UNKNOWN_PRODUCT' });
    if (raw === null) return send(400, { error: 'MISSING_PARAMETER', expected: 'quantity' });
    const quantity = Number(raw);
    if (!Number.isSafeInteger(quantity) || quantity < 1) return send(422, { error: 'QUANTITY_BELOW_MINIMUM' });
    return send(200, { product, quantity, total_centavos: PRICES[product] * quantity });
  }
  send(404, { error: 'NOT_FOUND' });
});

server.listen(0, '127.0.0.1', () => {
  process.stdout.write(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}`, version: SERVICE_VERSION }) + '\n');
});
process.on('SIGTERM', () => { server.close(); process.exit(0); });
