// Use each dialog's existing primary action so validation and API handling stay shared.
document.addEventListener('keydown', event => {
  if (event.key !== 'Enter' || event.defaultPrevented || event.isComposing || event.repeat ||
      event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target;
  if (target.closest('textarea, select, button, a, [contenteditable="true"]')) return;
  const alert = document.getElementById('custom-alert-backdrop');
  if (alert && !alert.classList.contains('pointer-events-none')) return;
  const actions = [
    ['new-folder-modal', 'create-folder-btn'],
    ['rename-modal', 'rename-submit-btn'],
    ['move-copy-modal', 'move-copy-submit-btn'],
    ['share-modal', 'generate-share-btn'],
  ];
  const open = actions.filter(([id]) => {
    const modal = document.getElementById(id);
    return modal && !modal.classList.contains('hidden') && !modal.hidden;
  });
  const entry = open.find(([id]) => document.getElementById(id).contains(target)) || open.at(-1);
  if (!entry) return;
  // Enter in the people picker should not save settings while choosing a person.
  if (target.id === 'share-user-search' && !document.getElementById('share-user-dropdown')?.classList.contains('hidden')) return;
  const button = document.getElementById(entry[1]);
  if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
  event.preventDefault();
  event.stopPropagation();
  button.click();
});
