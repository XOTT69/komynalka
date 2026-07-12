'use strict';

// =================== ACCESSIBLE DIALOGS ===================
const DIALOG_FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
let activeManagedDialog = null;
let dialogPreviousFocus = null;
let appDialogResolver = null;

function getDialogFocusables(dialog) {
  return [...dialog.querySelectorAll(DIALOG_FOCUSABLE)].filter(el => el.offsetParent !== null && !el.closest('.hidden'));
}

function activateManagedDialog(dialog) {
  if (!dialog || dialog.classList.contains('hidden') || activeManagedDialog === dialog) return;
  dialogPreviousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  activeManagedDialog = dialog;
  setTimeout(() => {
    const preferred = dialog.querySelector('[autofocus]') || getDialogFocusables(dialog)[0];
    preferred?.focus();
  }, 0);
}

function deactivateManagedDialog(dialog) {
  if (activeManagedDialog !== dialog) return;
  activeManagedDialog = null;
  if (dialogPreviousFocus?.isConnected) dialogPreviousFocus.focus();
  dialogPreviousFocus = null;
}

document.querySelectorAll('[role="dialog"]').forEach(dialog => {
  const observer = new MutationObserver(() => {
    if (dialog.classList.contains('hidden')) deactivateManagedDialog(dialog);
    else activateManagedDialog(dialog);
  });
  observer.observe(dialog, { attributes: true, attributeFilter: ['class'] });
});

document.addEventListener('keydown', event => {
  const dialog = activeManagedDialog;
  if (!dialog || dialog.classList.contains('hidden')) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    if (dialog.id === 'appDialog') settleAppDialog(null);
    else dialog.querySelector('[data-dialog-close]')?.click();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusables = getDialogFocusables(dialog);
  if (!focusables.length) { event.preventDefault(); dialog.focus(); return; }
  const first = focusables[0], last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});

function settleAppDialog(value) {
  const resolver = appDialogResolver;
  appDialogResolver = null;
  $('appDialog')?.classList.add('hidden');
  if (resolver) resolver(value);
}

function showAppDialog({ title, message = '', icon = '✓', confirmLabel = 'Підтвердити', cancelLabel = 'Скасувати', danger = false, mode = 'confirm', defaultValue = '' }) {
  if (appDialogResolver) settleAppDialog(null);
  const dialog = $('appDialog'), input = $('appDialogInput'), textarea = $('appDialogTextarea');
  if (!dialog || !input || !textarea) return Promise.resolve(null);
  $('appDialogTitle').textContent = title;
  $('appDialogMessage').textContent = message;
  $('appDialogIcon').textContent = icon;
  $('appDialogConfirmBtn').textContent = confirmLabel;
  $('appDialogCancelBtn').textContent = cancelLabel;
  $('appDialogConfirmBtn').classList.toggle('bg-red-500', danger);
  $('appDialogConfirmBtn').classList.toggle('bg-brand', !danger);
  input.classList.toggle('hidden', mode !== 'prompt');
  textarea.classList.toggle('hidden', mode !== 'copy');
  $('appDialogCancelBtn').classList.toggle('hidden', mode === 'copy');
  input.value = mode === 'prompt' ? defaultValue : '';
  textarea.value = mode === 'copy' ? defaultValue : '';
  dialog.classList.remove('hidden');
  setTimeout(() => {
    if (mode === 'prompt') { input.focus(); input.select(); }
    if (mode === 'copy') { textarea.focus(); textarea.select(); }
  }, 20);
  return new Promise(resolve => { appDialogResolver = resolve; });
}

function showAppConfirm(message, options = {}) {
  return showAppDialog({ title: options.title || 'Підтвердіть дію', message, icon: options.icon || (options.danger ? '!' : '✓'), confirmLabel: options.confirmLabel || 'Підтвердити', danger: Boolean(options.danger) });
}

function showAppPrompt(title, defaultValue = '', options = {}) {
  return showAppDialog({ title, message: options.message || '', icon: options.icon || '✎', confirmLabel: options.confirmLabel || 'Зберегти', mode: 'prompt', defaultValue });
}

function showCopyDialog(title, text) {
  return showAppDialog({ title, message: 'Автоматичне копіювання недоступне. Виділіть і скопіюйте текст вручну.', icon: '⧉', confirmLabel: 'Закрити', mode: 'copy', defaultValue: text });
}

$('appDialogConfirmBtn')?.addEventListener('click', () => {
  const input = $('appDialogInput'), textarea = $('appDialogTextarea');
  if (!input?.classList.contains('hidden')) settleAppDialog(input.value);
  else if (!textarea?.classList.contains('hidden')) settleAppDialog(true);
  else settleAppDialog(true);
});
$('appDialogCancelBtn')?.addEventListener('click', () => settleAppDialog(null));
$('appDialog')?.addEventListener('click', event => { if (event.target === event.currentTarget) settleAppDialog(null); });
$('appDialogInput')?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); $('appDialogConfirmBtn')?.click(); } });

window.showAppConfirm = showAppConfirm;

