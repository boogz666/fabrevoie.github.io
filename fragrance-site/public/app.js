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
