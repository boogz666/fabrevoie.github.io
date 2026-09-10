const orderElement = selector => document.querySelector(selector);
const TOKEN_STORAGE_KEY = 'fabrevoie-order-access-v1';
const CHECKOUT_STORAGE_KEY = 'fabrevoie-checkout-request-v1';
const validToken = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{43}$/.test(value);
const MAX_POLLS = 8;
const POLL_INTERVAL = 3000;
const states = {
  pending: ['AWAITING CONFIRMATION', 'Payment has not yet been confirmed. This page will update when its status is available.'],
  processing: ['PAYMENT PROCESSING', 'Your payment is processing. This page will update when its status is confirmed.'],
  paid: ['PAYMENT CONFIRMED', 'Your payment is confirmed. Your order reference and details are below.'],
  payment_failed: ['PAYMENT NOT COMPLETED', 'Your payment could not be completed. Contact us if you need help before trying again.'],
  expired: ['CHECKOUT EXPIRED', 'This checkout has expired. Return to the fragrance to start a new checkout.'],
  refunded: ['ORDER REFUNDED', 'A refund has been recorded for this order. Contact us with your reference if you need details.'],
  partially_refunded: ['PARTIALLY REFUNDED', 'A partial refund has been recorded for this order. Contact us with your reference if you need details.']
};
let token;
let attempts = 0;
let busy = false;
let pollTimer;
let requestController;
let stillPending = false;
let leaving = false;

const fragment = new URLSearchParams(location.hash.slice(1));
const suppliedToken = fragment.get('order');
if (validToken(suppliedToken)) {
  token = suppliedToken;
  try { sessionStorage.setItem(TOKEN_STORAGE_KEY, token); } catch { /* The current page still works. */ }
} else if (!location.hash && !location.search) {
  try { const saved = sessionStorage.getItem(TOKEN_STORAGE_KEY); if (validToken(saved)) token = saved; } catch { /* A private link can be opened again. */ }
}
// Keep the capability out of the address bar and future navigation/referrers.
history.replaceState(null, '', location.pathname);

function showStatus(label, message, error = false) {
  orderElement('#order-state-label').textContent = label;
  orderElement('#order-state-message').textContent = message;
  orderElement('#order-status').dataset.state = error ? 'error' : '';
}
function formatOrderTotal(amount, currency) {
  const formatter = new Intl.NumberFormat('en', { style: 'currency', currency: currency.toUpperCase() });
  return formatter.format(amount / (10 ** formatter.resolvedOptions().maximumFractionDigits));
}
function validOrder(order) {
  return order && Object.hasOwn(states, order.status) && ['test', 'live'].includes(order.mode)
    && typeof order.reference === 'string' && order.reference.trim().length > 0 && order.reference.length <= 120
    && Number.isSafeInteger(order.quantity) && order.quantity > 0 && /^[a-z]{3}$/i.test(order.currency)
    && (order.amountTotal === null || (Number.isSafeInteger(order.amountTotal) && order.amountTotal >= 0))
    && typeof order.dispatchNotice === 'string';
}
function renderOrder(order) {
  const formattedTotal = order.amountTotal === null ? 'Not yet confirmed' : formatOrderTotal(order.amountTotal, order.currency);
  const [label, message] = states[order.status];
  showStatus(label, message, order.status === 'payment_failed');
  orderElement('#order-test-notice').hidden = order.mode !== 'test';
  orderElement('#order-reference').textContent = order.reference;
  orderElement('#order-quantity').textContent = String(order.quantity);
  orderElement('#order-total').textContent = formattedTotal;
  orderElement('#order-total-label').textContent = order.status === 'paid' ? 'TOTAL PAID' : 'ORDER TOTAL';
  orderElement('#order-details').hidden = false;
  orderElement('#order-help-reference').hidden = false;
  orderElement('#order-dispatch').textContent = order.dispatchNotice;
  orderElement('#order-dispatch').hidden = !order.dispatchNotice.trim() || ['payment_failed', 'expired', 'refunded', 'partially_refunded'].includes(order.status);
  stillPending = ['pending', 'processing'].includes(order.status);
  if (!stillPending) {
    try { sessionStorage.removeItem(CHECKOUT_STORAGE_KEY); } catch { /* Optional retry context. */ }
  }
}
function schedulePoll() {
  clearTimeout(pollTimer);
  if (!stillPending) { orderElement('#order-poll-note').textContent = ''; return; }
  if (attempts >= MAX_POLLS) {
    orderElement('#order-poll-note').textContent = 'Confirmation is taking a little longer. You can check again or return using your private link.';
    return;
  }
  orderElement('#order-poll-note').textContent = 'Checking for an update automatically.';
  if (document.visibilityState === 'visible') pollTimer = setTimeout(checkOrder, POLL_INTERVAL);
}
async function checkOrder() {
  if (!token || busy || leaving) return;
  clearTimeout(pollTimer);
  busy = true;
  attempts += 1;
  const refresh = orderElement('#order-refresh');
  refresh.disabled = true;
  orderElement('#order-status').setAttribute('aria-busy', 'true');
  requestController = new AbortController();
  const timeout = setTimeout(() => requestController.abort(), 10000);
  try {
    const response = await fetch('/api/order-status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      cache: 'no-store', referrerPolicy: 'no-referrer', signal: requestController.signal,
      body: JSON.stringify({ token })
    });
    let result;
    try { result = await response.json(); }
    catch { throw new Error('Your order status could not be confirmed. Please check again shortly.'); }
    if (!response.ok || result?.ok !== true || !validOrder(result.order)) {
      throw new Error(response.status === 404 ? 'This private order link could not be found. Check your original link or contact FABREVOIE.' : 'Your order status could not be confirmed. Please check again shortly.');
    }
    renderOrder(result.order);
    schedulePoll();
  } catch (error) {
    if (!leaving) {
      stillPending = false;
      showStatus('STATUS UNAVAILABLE', error.name === 'AbortError' || error instanceof TypeError
        ? 'We could not check your order. Check your connection and try again.' : error.message, true);
      orderElement('#order-poll-note').textContent = 'No payment status has been assumed. Use your private link to check again.';
    }
  } finally {
    clearTimeout(timeout);
    busy = false;
    refresh.disabled = false;
    refresh.hidden = false;
    orderElement('#order-status').removeAttribute('aria-busy');
  }
}
orderElement('#order-refresh').addEventListener('click', () => { attempts = 0; checkOrder(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') clearTimeout(pollTimer);
  else if (stillPending && !busy && attempts < MAX_POLLS) schedulePoll();
});
window.addEventListener('pagehide', () => { leaving = true; clearTimeout(pollTimer); requestController?.abort(); });
window.addEventListener('pageshow', event => { if (event.persisted) { leaving = false; attempts = 0; checkOrder(); } });
window.addEventListener('hashchange', () => { if (location.hash) location.reload(); });
if (token) {
  const privateLink = orderElement('#order-private-link');
  privateLink.href = `${location.origin}/order.html#order=${encodeURIComponent(token)}`;
  privateLink.rel = 'noreferrer';
  privateLink.hidden = false;
  checkOrder();
} else {
  showStatus('PRIVATE LINK NEEDED', 'Open the private order link from your checkout to see its confirmed status. Contact FABREVOIE if you need help.');
}
