/** Shop client. Totals shown here are recomputed from server prices; the server prices the
 * order again on submit, so nothing here can decide what is charged.
 */
const defect = document.body.dataset.defect;
const state = { products: [], cart: new Map(), idempotencyKey: crypto.randomUUID() };

const peso = centavos => `₱${(centavos / 100).toFixed(2)}`;
const el = id => document.getElementById(id);

async function loadCatalog() {
  const status = el('catalog-status');
  try {
    const response = await fetch('/api/products');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    state.products = body.products;
    status.hidden = true;
    renderCatalog();
  } catch (error) {
    status.hidden = false;
    status.textContent = `Products could not be loaded (${error.message}). Please try again.`;
    status.classList.add('error');
  }
}

function renderCatalog() {
  const list = el('catalog');
  list.replaceChildren(...state.products.map(product => {
    const item = document.createElement('li');

    const name = document.createElement('span');
    name.className = 'product-name';
    name.textContent = product.name;

    const price = document.createElement('span');
    price.className = 'product-price';
    price.textContent = peso(product.price_centavos);

    const add = document.createElement('button');
    add.type = 'button';
    add.textContent = `Add ${product.name}`;
    add.dataset.testid = `add-${product.product_id}`;
    add.addEventListener('click', () => {
      const current = state.cart.get(product.product_id) ?? 0;
      state.cart.set(product.product_id, current + 1);
      renderCart();
    });

    item.append(name, price, add);
    return item;
  }));
}

function renderCart() {
  const empty = el('cart-empty');
  const table = el('cart-table');
  const body = el('cart-body');
  if (state.cart.size === 0) {
    empty.hidden = false;
    table.hidden = true;
    el('cart-total').textContent = peso(0);
    return;
  }
  empty.hidden = true;
  table.hidden = false;

  let total = 0;
  body.replaceChildren(...[...state.cart.entries()].map(([product_id, quantity]) => {
    const product = state.products.find(entry => entry.product_id === product_id);
    const subtotal = product.price_centavos * quantity;
    total += subtotal;

    const row = document.createElement('tr');

    const nameCell = document.createElement('th');
    nameCell.scope = 'row';
    nameCell.textContent = product.name;

    const quantityCell = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.max = '99';
    input.value = String(quantity);
    input.id = `quantity-${product_id}`;
    input.dataset.testid = `quantity-${product_id}`;
    const label = document.createElement('label');
    label.htmlFor = input.id;
    label.className = 'visually-hidden';
    label.textContent = `Quantity of ${product.name}`;
    input.addEventListener('change', () => {
      const next = Number.parseInt(input.value, 10);
      if (Number.isSafeInteger(next) && next >= 1 && next <= 99) state.cart.set(product_id, next);
      else input.value = String(state.cart.get(product_id));
      renderCart();
    });
    // Injectable public mutation: the quantity control loses its accessible name.
    if (defect !== 'missing-label') quantityCell.append(label);
    quantityCell.append(input);

    const subtotalCell = document.createElement('td');
    subtotalCell.textContent = peso(subtotal);

    const removeCell = document.createElement('td');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'secondary';
    remove.textContent = `Remove ${product.name}`;
    remove.dataset.testid = `remove-${product_id}`;
    remove.addEventListener('click', () => { state.cart.delete(product_id); renderCart(); });
    removeCell.append(remove);

    row.append(nameCell, quantityCell, subtotalCell, removeCell);
    return row;
  }));
  el('cart-total').textContent = peso(total);
}

el('checkout-form').addEventListener('submit', async event => {
  event.preventDefault();
  const error = el('form-error');
  const confirmation = el('confirmation');
  error.hidden = true;
  confirmation.hidden = true;

  const items = [...state.cart.entries()].map(([product_id, quantity]) => ({ product_id, quantity }));
  if (items.length === 0) {
    error.hidden = false;
    error.textContent = 'Add at least one product before checking out.';
    return;
  }
  const button = el('place-order');
  button.disabled = true;
  button.textContent = 'Placing order…';
  try {
    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': state.idempotencyKey },
      body: JSON.stringify({ items, customer: { name: el('customer-name').value, mobile: el('customer-mobile').value } }),
    });
    const body = await response.json();
    if (!response.ok) {
      error.hidden = false;
      error.textContent = `We could not place the order: ${(body.details ?? [body.error]).join(', ')}`;
      return;
    }
    confirmation.hidden = false;
    confirmation.dataset.testid = 'confirmation';
    confirmation.textContent = `Order ${body.order.order_id} received. Total ${peso(body.order.total_centavos)}. We will contact ${body.order.customer_mobile}.`;
    state.cart.clear();
    renderCart();
  } catch (networkError) {
    error.hidden = false;
    error.textContent = `Network problem: ${networkError.message}. Please try again.`;
  } finally {
    button.disabled = false;
    button.textContent = 'Place order';
  }
});

loadCatalog();
renderCart();
