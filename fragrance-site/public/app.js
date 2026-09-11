const $ = (selector, context = document) => context.querySelector(selector);
const $$ = (selector, context = document) => [...context.querySelectorAll(selector)];
const dialogs = $$('dialog');
const menu = $('#menu-dialog');
const privacy = $('#privacy-dialog');
const imageDialog = $('#image-dialog');
const waitlist = $('#waitlist-dialog');
const signupAvailable = document.documentElement.dataset.signupAvailable === 'true';

function openDialog(dialog) {
  for (const other of dialogs) if (other !== dialog && other.open) other.close('switch');
  if (!dialog.open) {
    dialog.returnValue = '';
    dialog.showModal();
  }
  document.body.classList.add('dialog-open');
}
for (const dialog of dialogs) {
  $('[data-close]', dialog)?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (!dialogs.some(item => item.open)) document.body.classList.remove('dialog-open');
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
}
$('.menu-toggle').addEventListener('click', () => openDialog(menu));
$$('a', menu).forEach(link => link.addEventListener('click', () => menu.close()));
const desktopBreakpoint = matchMedia('(min-width: 761px)');
desktopBreakpoint.addEventListener('change', event => { if (event.matches && menu.open) menu.close(); });

const tabs = $$('.gallery-tab');
const productImage = $('#product-image');
const expandedImage = $('#expanded-image');
let galleryIndex = 0;
function selectImage(index) {
  galleryIndex = (index + tabs.length) % tabs.length;
  const tab = tabs[galleryIndex];
  for (const button of tabs) button.setAttribute('aria-pressed', String(button === tab));
  productImage.src = tab.dataset.image;
  productImage.alt = tab.dataset.alt;
  expandedImage.src = tab.dataset.image;
  expandedImage.alt = tab.dataset.alt;
  $('#gallery-status').textContent = tab.dataset.caption;
  $('#image-dialog-title').textContent = tab.dataset.caption;
  $('.product-image-button').setAttribute('aria-label', `Enlarge photograph: ${tab.textContent.trim().replace(/\s+/g, ' ')}`);
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectImage(index));
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : index + (event.key === 'ArrowRight' ? 1 : -1);
    selectImage(next);
    tabs[galleryIndex].focus();
  });
});
$('.product-image-button').addEventListener('click', () => { selectImage(galleryIndex); openDialog(imageDialog); });
$$('[data-gallery-step]').forEach(button => button.addEventListener('click', () => selectImage(galleryIndex + Number(button.dataset.galleryStep))));
imageDialog.addEventListener('keydown', event => {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    selectImage(galleryIndex + (event.key === 'ArrowRight' ? 1 : -1));
  }
});

const campaignDialog = $('#campaign-dialog');
const campaignLinks = $$('.campaign-image-link');
const campaignImage = $('#campaign-expanded-image');
let campaignIndex = 0;
function selectCampaign(index) {
  campaignIndex = (index + campaignLinks.length) % campaignLinks.length;
  const link = campaignLinks[campaignIndex];
  campaignImage.src = link.href;
  campaignImage.alt = $('img', link).alt;
  $('#campaign-dialog-title').textContent = link.dataset.campaignTitle;
  $('#campaign-dialog-status').textContent = `${String(campaignIndex + 1).padStart(2, '0')} / ${campaignLinks.length}`;
}
campaignLinks.forEach((link, index) => link.addEventListener('click', event => {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  selectCampaign(index);
  openDialog(campaignDialog);
}));
$$('[data-campaign-step]').forEach(button => button.addEventListener('click', () => selectCampaign(campaignIndex + Number(button.dataset.campaignStep))));
campaignDialog.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  selectCampaign(event.key === 'Home' ? 0 : event.key === 'End' ? campaignLinks.length - 1 : campaignIndex + (event.key === 'ArrowRight' ? 1 : -1));
});

if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.remove('is-pending');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: .08 });
  $$('.reveal').forEach(item => {
    if (item.getBoundingClientRect().top > window.innerHeight) item.classList.add('is-pending');
    observer.observe(item);
  });
}

const STORAGE_KEY = 'fabrevoie-withdrawal-keys-v1';
const isWithdrawalKey = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{43}$/.test(value);
let withdrawalKeys = [];
try {
  const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  if (Array.isArray(stored)) withdrawalKeys = [...new Set(stored.filter(isWithdrawalKey))];
} catch { /* Storage is optional: signup and a private withdrawal link still work. */ }
function storeKeys() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(withdrawalKeys)); return true; }
  catch { return false; }
}
function acceptWithdrawalLink() {
  const incomingKey = new URLSearchParams(location.hash.slice(1)).get('withdraw');
  if (!isWithdrawalKey(incomingKey)) return;
  if (!withdrawalKeys.includes(incomingKey)) withdrawalKeys.push(incomingKey);
  storeKeys();
  history.replaceState(null, '', location.pathname + location.search);
  updateWithdrawal();
  openDialog(privacy);
}
function updateWithdrawal() {
  const available = withdrawalKeys.length > 0;
  $('#withdraw-signup').disabled = !available;
  if (!available && !$('#withdraw-status').textContent) $('#withdraw-status').textContent = 'No signup saved on this browser yet.';
  if (available && $('#withdraw-status').textContent === 'No signup saved on this browser yet.') $('#withdraw-status').textContent = '';
}
let returnToWaitlist = false;
$$('[data-privacy]').forEach(button => button.addEventListener('click', () => {
  returnToWaitlist = waitlist.open;
  if (returnToWaitlist) waitlist.close('privacy');
  updateWithdrawal();
  openDialog(privacy);
}));
privacy.addEventListener('close', () => {
  if (!returnToWaitlist) return;
  returnToWaitlist = false;
  if (signupAvailable && privacy.returnValue !== 'switch') {
    openDialog(waitlist);
    $('[data-privacy]', waitlist).focus();
  }
});
updateWithdrawal();
acceptWithdrawalLink();
window.addEventListener('hashchange', acceptWithdrawalLink);

const signupForms = $$('[data-signup-form]');
const inlineSignup = $('#signup-form');
const INVITATION_STORAGE_KEY = 'fabrevoie-invitation-state-v1';
const DISMISSAL_DURATION = 7 * 24 * 60 * 60 * 1000;
let invitationState = { dismissedUntil: 0, joined: false };
let invitationTimer;
let autoInvitationStopped = false;
let signupBusy = false;
try {
  const stored = JSON.parse(localStorage.getItem(INVITATION_STORAGE_KEY) || '{}');
  if (stored && typeof stored === 'object') {
    invitationState.joined = stored.joined === true;
    if (Number.isFinite(stored.dismissedUntil)) invitationState.dismissedUntil = stored.dismissedUntil;
  }
} catch { /* The invitation also works when local storage is unavailable. */ }
function storeInvitationState() {
  try { localStorage.setItem(INVITATION_STORAGE_KEY, JSON.stringify(invitationState)); }
  catch { /* In-memory dismissal still lasts for the current page visit. */ }
}
function stopAutoInvitation() {
  autoInvitationStopped = true;
  clearTimeout(invitationTimer);
}
function autoInvitationSuppressed() {
  return !signupAvailable || autoInvitationStopped || invitationState.joined || withdrawalKeys.length > 0 || invitationState.dismissedUntil > Date.now();
}
function openInvitation() {
  if (!signupAvailable) return false;
  stopAutoInvitation();
  openDialog(waitlist);
  return true;
}
$$('[data-open-signup]').forEach(link => link.addEventListener('click', event => {
  if (!signupAvailable) return;
  event.preventDefault();
  openInvitation();
}));
waitlist.addEventListener('close', () => {
  if (waitlist.returnValue === 'privacy') return;
  stopAutoInvitation();
  invitationState.dismissedUntil = Date.now() + DISMISSAL_DURATION;
  storeInvitationState();
});
function attemptAutoInvitation() {
  if (autoInvitationSuppressed()) return;
  const email = inlineSignup.elements.namedItem('email');
  const consent = inlineSignup.elements.namedItem('consent');
  if (email.value.trim() || consent.checked) { stopAutoInvitation(); return; }
  const inlineBounds = inlineSignup.getBoundingClientRect();
  const inlineVisible = !inlineSignup.hidden && inlineBounds.top < innerHeight && inlineBounds.bottom > 0;
  const editing = document.activeElement?.matches('input, textarea, select, [contenteditable="true"]');
  if (document.visibilityState !== 'visible' || dialogs.some(dialog => dialog.open) || signupBusy || inlineVisible || editing) {
    invitationTimer = setTimeout(attemptAutoInvitation, 5000);
    return;
  }
  openInvitation();
}
if (!autoInvitationSuppressed()) invitationTimer = setTimeout(attemptAutoInvitation, 15000);
window.addEventListener('storage', event => {
  if (event.key !== INVITATION_STORAGE_KEY) return;
  try {
    const state = JSON.parse(event.newValue || '{}');
    if (!state || typeof state !== 'object' || Array.isArray(state)) return;
    invitationState = {
      joined: state.joined === true,
      dismissedUntil: Number.isFinite(state.dismissedUntil) ? state.dismissedUntil : 0
    };
    if (state?.joined === true || state?.dismissedUntil > Date.now()) stopAutoInvitation();
  } catch { /* Ignore malformed state from another page. */ }
});
function status(element, message, state = '') {
  element.textContent = message;
  element.dataset.state = state;
}
async function apiRequest(method, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('/api/signup', {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    let data;
    try { data = await response.json(); }
    catch { throw new Error('The release list is temporarily unavailable. Please try again shortly.'); }
    if (!response.ok || data?.ok !== true) throw new Error(typeof data?.message === 'string' ? data.message : 'We couldn’t save your signup. Please try again.');
    return data;
  } finally { clearTimeout(timeout); }
}
for (const signupForm of signupForms) {
  const signupStatus = $('[role=status]', signupForm);
  const submit = $('button[type=submit]', signupForm);
  const submitLabel = $('.submit-label', submit);
  if (!signupAvailable) submit.disabled = true;
  signupForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!signupAvailable) {
      status(signupStatus, 'The release list is temporarily unavailable. Please try again shortly.', 'error');
      return;
    }
    if (signupBusy || !signupForm.reportValidity()) return;
    signupBusy = true;
    for (const form of signupForms) $('button[type=submit]', form).disabled = true;
    submitLabel.textContent = 'Joining';
    signupForm.setAttribute('aria-busy', 'true');
    status(signupStatus, 'Saving your invitation…');
    try {
      const data = await apiRequest('POST', {
        email: signupForm.elements.namedItem('email').value.trim(),
        consent: signupForm.elements.namedItem('consent').checked,
        website: signupForm.elements.namedItem('website').value
      });
      invitationState.joined = true;
      storeInvitationState();
      stopAutoInvitation();
      status(signupStatus, 'You’re on the list. Look out for news of the 1 October release.', 'success');
      if (isWithdrawalKey(data.removalToken)) {
        if (!withdrawalKeys.includes(data.removalToken)) withdrawalKeys.push(data.removalToken);
        storeKeys();
        const link = document.createElement('a');
        link.href = `${location.origin}/#withdraw=${encodeURIComponent(data.removalToken)}`;
        link.textContent = 'Keep your private withdrawal link.';
        signupStatus.append(link);
        updateWithdrawal();
      }
      signupForm.reset();
      submitLabel.textContent = 'Joined';
    } catch (error) {
      const message = error.name === 'AbortError' || error instanceof TypeError
        ? 'We couldn’t confirm your signup. Check your connection and try again.'
        : error.message;
      status(signupStatus, message, 'error');
      submitLabel.textContent = 'Try again';
    } finally {
      signupBusy = false;
      for (const form of signupForms) $('button[type=submit]', form).disabled = !signupAvailable;
      signupForm.removeAttribute('aria-busy');
    }
  });
  signupForm.addEventListener('input', () => {
    if (!submit.disabled) submitLabel.textContent = 'Join the list';
  });
}
$('#withdraw-signup').addEventListener('click', async () => {
  const button = $('#withdraw-signup');
  const output = $('#withdraw-status');
  button.disabled = true;
  status(output, 'Removing your signup…');
  try {
    for (const token of [...withdrawalKeys]) {
      await apiRequest('DELETE', { token });
      withdrawalKeys = withdrawalKeys.filter(item => item !== token);
      storeKeys();
    }
    status(output, 'Your signup has been removed.', 'success');
    invitationState.joined = false;
    storeInvitationState();
    stopAutoInvitation();
    for (const form of signupForms) {
      status($('[role=status]', form), '');
      $('.submit-label', form).textContent = 'Join the list';
    }
  } catch (error) {
    status(output, 'We couldn’t remove your signup just now. Please try again.', 'error');
  } finally { updateWithdrawal(); }
});

// Commerce is optional: the launch list remains usable if it is not enabled.
const CHECKOUT_STORAGE_KEY = 'fabrevoie-checkout-request-v1';
const checkoutForm = $('#checkout-form');
const checkoutQuantity = $('#checkout-quantity');
const checkoutSubmit = $('#checkout-submit');
const checkoutStatus = $('#checkout-status');
const checkoutLabel = $('span', checkoutSubmit);
let commerceConfig;
let checkoutContext;
let checkoutBusy = false;
let checkoutContextLoaded = false;
const checkoutUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function formatPrice(amount, currency) {
  const formatter = new Intl.NumberFormat('en', { style: 'currency', currency: currency.toUpperCase() });
  const decimals = formatter.resolvedOptions().maximumFractionDigits;
  return formatter.format(amount / (10 ** decimals));
}
function updateSubtotal() {
  $('#checkout-subtotal').textContent = formatPrice(commerceConfig.product.unitAmount * Number(checkoutQuantity.value), commerceConfig.product.currency);
}
function validCommerce(config) {
  const inStock = config?.inventory?.status === 'in_stock' && config.available === true && config.quantityMax >= 1;
  const soldOut = config?.inventory?.status === 'sold_out' && config.available === false && config.quantityMax === 0;
  return config?.ok === true && (inStock || soldOut) && ['test', 'live'].includes(config.mode)
    && config.product?.name === 'ULTRA MACHO' && Number.isSafeInteger(config.product.unitAmount) && config.product.unitAmount > 0
    && /^[a-z]{3}$/i.test(config.product.currency) && Number.isInteger(config.quantityMax) && config.quantityMax >= 0 && config.quantityMax <= 99
    && Number.isSafeInteger(config.product.unitAmount * config.quantityMax)
    && typeof config.dispatchNotice === 'string' && config.dispatchNotice.trim().length > 0;
}
function checkoutSignature() {
  return `${commerceConfig.mode}:${commerceConfig.product.currency}:${commerceConfig.product.unitAmount}`;
}
function saveCheckoutContext() {
  try { sessionStorage.setItem(CHECKOUT_STORAGE_KEY, JSON.stringify(checkoutContext)); }
  catch { /* Keep the same request ID in memory when browser storage is blocked. */ }
}
function canResumeCheckout() {
  return commerceConfig && (checkoutContext?.started === true || checkoutContext?.uncertain === true) && checkoutUuid.test(checkoutContext.requestId)
    && checkoutContext.signature === checkoutSignature() && Number.isInteger(checkoutContext.quantity)
    && checkoutContext.quantity >= 1 && checkoutContext.quantity <= 99;
}
function resumeOnlyCheckout() {
  return canResumeCheckout() && (!commerceConfig.available || checkoutContext.quantity > commerceConfig.quantityMax);
}
function checkoutRequestId(quantity) {
  const signature = checkoutSignature();
  if (!checkoutContext || !checkoutUuid.test(checkoutContext.requestId) || checkoutContext.quantity !== quantity || checkoutContext.signature !== signature) {
    checkoutContext = { requestId: crypto.randomUUID(), quantity, signature };
  }
  // Persist before sending: navigation or a lost response can interrupt this
  // page while the server still creates a reservation for the same request.
  checkoutContext.uncertain = true;
  saveCheckoutContext();
  return checkoutContext.requestId;
}
function setCheckoutBusy(busy) {
  checkoutBusy = busy;
  checkoutSubmit.disabled = busy || !(commerceConfig?.available || canResumeCheckout());
  checkoutQuantity.disabled = busy;
  checkoutForm.toggleAttribute('aria-busy', busy);
  if (busy) checkoutForm.setAttribute('aria-busy', 'true');
  checkoutLabel.textContent = busy ? 'Opening checkout' : resumeOnlyCheckout()
    ? checkoutContext.started === true ? 'Resume your checkout' : 'Check your checkout'
    : 'Continue to checkout';
}
function renderCommerce() {
  const soldOut = commerceConfig.inventory.status === 'sold_out';
  const resumeOnly = resumeOnlyCheckout();
  const checkoutHadFocus = checkoutForm.contains(document.activeElement) || (checkoutBusy && document.activeElement === document.body);
  const quantityBefore = checkoutQuantity.value || String(checkoutContext?.quantity || 1);
  checkoutQuantity.replaceChildren();
  for (let quantity = 1; quantity <= commerceConfig.quantityMax; quantity += 1) {
    checkoutQuantity.add(new Option(String(quantity), String(quantity)));
  }
  if (Number(quantityBefore) >= 1 && Number(quantityBefore) <= commerceConfig.quantityMax) checkoutQuantity.value = quantityBefore;
  $('#commerce-availability').hidden = false;
  $('#commerce-availability').dataset.state = soldOut ? 'sold_out' : 'in_stock';
  $('#commerce-availability-label').textContent = soldOut ? 'SOLD OUT.' : 'AVAILABLE';
  $('#commerce-availability-message').textContent = resumeOnly
    ? checkoutContext.started === true ? 'You can return to the checkout already started in this tab.'
      : 'Your previous checkout could not be confirmed. Check it before starting another.'
    : soldOut ? 'Join the list for news from FABREVOIE.' : '';
  $('#commerce-waitlist-link').hidden = !soldOut;
  $('#purchase-price').hidden = soldOut || resumeOnly;
  checkoutForm.hidden = soldOut && !resumeOnly;
  $('.purchase-controls', checkoutForm).hidden = resumeOnly;
  $('#product-unit-price').textContent = soldOut ? '' : formatPrice(commerceConfig.product.unitAmount, commerceConfig.product.currency);
  $('#commerce-dispatch').textContent = commerceConfig.dispatchNotice;
  $('#commerce-shipping').textContent = typeof commerceConfig.shippingSummary === 'string' ? commerceConfig.shippingSummary : '';
  $('#commerce-shipping').hidden = !$('#commerce-shipping').textContent.trim();
  $('#commerce-test-notice').hidden = commerceConfig.mode !== 'test';
  if (!soldOut) updateSubtotal();
  else $('#checkout-subtotal').textContent = '';
  setCheckoutBusy(checkoutBusy);
  $('#purchase-panel').hidden = false;
  if (soldOut && !resumeOnly && checkoutHadFocus) $('#commerce-waitlist-link').focus({ preventScroll: true });
}
checkoutForm.addEventListener('focusin', stopAutoInvitation);
checkoutQuantity.addEventListener('change', () => {
  if (!commerceConfig) return;
  updateSubtotal();
  status(checkoutStatus, '');
});
checkoutForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (checkoutBusy) return;
  if (!commerceConfig) { status(checkoutStatus, 'Checkout is not currently available.', 'error'); return; }
  const resumeOnly = resumeOnlyCheckout();
  const quantity = resumeOnly ? checkoutContext.quantity : Number(checkoutQuantity.value);
  if (!commerceConfig.available && !resumeOnly) {
    status(checkoutStatus, 'This release is sold out. Join the list for news from FABREVOIE.', 'error');
    return;
  }
  if (!Number.isInteger(quantity) || quantity < 1 || (!resumeOnly && quantity > commerceConfig.quantityMax)) {
    status(checkoutStatus, `Choose a quantity from 1 to ${commerceConfig.quantityMax}.`, 'error');
    return;
  }
  stopAutoInvitation();
  setCheckoutBusy(true);
  status(checkoutStatus, 'Preparing your secure checkout.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let redirecting = false;
  try {
    const response = await fetch('/api/checkout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal,
      body: JSON.stringify({ quantity, requestId: checkoutRequestId(quantity) })
    });
    let result;
    try { result = await response.json(); }
    catch { throw new Error('Checkout is temporarily unavailable. Please try again.'); }
    if (response.status === 409 && result?.code === 'CHECKOUT_RESTART_REQUIRED') {
      checkoutContext = null;
      try { sessionStorage.removeItem(CHECKOUT_STORAGE_KEY); } catch { /* In-memory context is already cleared. */ }
      renderCommerce();
      throw new Error(commerceConfig.available ? 'This checkout can no longer be used. Please try again to start a new one.' : 'This checkout can no longer be used. Join the list for news from FABREVOIE.');
    }
    if (response.status === 409 && result?.code === 'STOCK_UNAVAILABLE') {
      // A stock race creates no reservation. Keep the UUID, and refresh the
      // available quantities without treating transient creation as a sellout.
      if (checkoutContext) { checkoutContext.started = false; checkoutContext.uncertain = false; saveCheckoutContext(); }
      await loadCommerce();
      throw new Error('Availability has changed. Please check the current quantities before trying again.');
    }
    if (!response.ok || result?.ok !== true) throw new Error(typeof result?.message === 'string' ? result.message : 'Checkout could not be opened. Please try again.');
    let destination;
    try { destination = new URL(result.url); }
    catch { throw new Error('A secure checkout link could not be confirmed. Please try again.'); }
    if (destination.protocol !== 'https:' || destination.hostname !== 'checkout.stripe.com' || destination.username || destination.password || destination.port) {
      throw new Error('A secure checkout link could not be confirmed. Please try again.');
    }
    checkoutContext.started = true;
    checkoutContext.uncertain = false;
    saveCheckoutContext();
    status(checkoutStatus, 'Opening secure checkout.');
    location.assign(destination.href);
    redirecting = true;
  } catch (error) {
    status(checkoutStatus, error.name === 'AbortError' || error instanceof TypeError
      ? 'We could not open checkout. Check your connection and try again.' : error.message, 'error');
  } finally {
    clearTimeout(timeout);
    if (!redirecting) setCheckoutBusy(false);
  }
});
window.addEventListener('pageshow', event => {
  if (event.persisted) { setCheckoutBusy(false); status(checkoutStatus, ''); loadCommerce(); }
});
async function loadCommerce() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch('/api/commerce', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
    if (!response.ok) return;
    const config = await response.json();
    if (config?.ok === true && config.available === false && config.mode === 'disabled') {
      commerceConfig = null;
      $('#purchase-panel').hidden = true;
      return;
    }
    if (!validCommerce(config)) return;
    formatPrice(config.product.unitAmount, config.product.currency);
    commerceConfig = config;
    if (!checkoutContextLoaded) {
      try { checkoutContext = JSON.parse(sessionStorage.getItem(CHECKOUT_STORAGE_KEY) || 'null'); }
      catch { /* Keep any in-memory retry context. */ }
      checkoutContextLoaded = true;
    }
    renderCommerce();
  } catch { /* An unavailable commerce service does not interrupt the waitlist. */ }
  finally { clearTimeout(timeout); }
}
loadCommerce();
