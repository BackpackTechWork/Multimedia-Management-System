document.addEventListener('DOMContentLoaded', () => {
  const area = document.getElementById('shared-files');
  if (!area) return;
  const cards = Array.from(area.querySelectorAll('.share-file-card'));
  const checks = cards.map(card => card.querySelector('input[type="checkbox"]'));
  const all = document.getElementById('share-select-all');
  const count = document.getElementById('share-selection-count');
  const download = document.getElementById('share-download-selected');
  const toolbar = document.getElementById('share-selection-toolbar');
  let anchor = 0;
  let suppressClick = false;
  const update = () => {
    const selected = checks.filter(check => check.checked).length;
    toolbar.hidden = selected === 0;
    cards.forEach((card, index) => card.classList.toggle('is-selected', checks[index].checked));
    all.checked = selected === checks.length && selected > 0;
    all.indeterminate = selected > 0 && selected < checks.length;
    count.textContent = selected ? `${selected} file${selected === 1 ? '' : 's'} selected` : 'No files selected';
    if (selected > 500) count.textContent = `${selected} files selected. Select up to 500 per download.`;
    if (download) download.disabled = selected === 0 || selected > 500;
  };
  all.addEventListener('change', () => { checks.forEach(check => { check.checked = all.checked; }); update(); });
  area.addEventListener('change', update);
  area.closest('.share-page').addEventListener('click', event => {
    if (suppressClick || event.target.closest('.share-file-card, a, button, input, label, form')) return;
    checks.forEach(check => { check.checked = false; });
    update();
  });
  cards.forEach((card, index) => {
    card.addEventListener('keydown', event => {
      if (event.target === card && (event.key === ' ' || event.key === 'Enter')) {
        event.preventDefault();
        card.click();
      }
    });
    card.addEventListener('dragstart', event => event.preventDefault());
    card.addEventListener('click', event => {
      if (suppressClick) { event.preventDefault(); return; }
      if (event.target.closest('a, button, input, label')) return;
      if (event.shiftKey) {
        checks.forEach((check, i) => { if (i >= Math.min(anchor, index) && i <= Math.max(anchor, index)) check.checked = true; });
      } else if (event.ctrlKey || event.metaKey) {
        checks[index].checked = !checks[index].checked;
      } else {
        const next = !checks[index].checked;
        checks.forEach(check => { check.checked = false; });
        checks[index].checked = next;
      }
      anchor = index;
      update();
    });
  });
  area.addEventListener('keydown', event => {
    if (event.key === 'Escape') { checks.forEach(check => { check.checked = false; }); update(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault(); checks.forEach(check => { check.checked = true; }); update();
    }
  });
  area.closest('main').addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.pointerType === 'touch' || event.target.closest('a, button, input, label, form')) return;
    event.preventDefault();
    event.target.closest('.share-file-card')?.focus({ preventScroll: true });
    document.body.classList.add('share-drag-selecting');
    window.getSelection()?.removeAllRanges();
    const start = { x: event.clientX, y: event.clientY };
    const previous = checks.map(check => check.checked);
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    let box;
    const move = e => {
      if (!box && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 5) return;
      e.preventDefault();
      if (!box) { box = document.createElement('div'); box.className = 'share-selection-box'; document.body.append(box); }
      const left = Math.min(start.x, e.clientX), top = Math.min(start.y, e.clientY);
      const right = Math.max(start.x, e.clientX), bottom = Math.max(start.y, e.clientY);
      Object.assign(box.style, { left: `${left}px`, top: `${top}px`, width: `${right-left}px`, height: `${bottom-top}px` });
      cards.forEach((card, i) => {
        const rect = card.getBoundingClientRect();
        const hit = rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top;
        checks[i].checked = hit || (additive && previous[i]);
      });
      update();
    };
    const finish = () => {
      document.body.classList.remove('share-drag-selecting');
      if (box) { box.remove(); suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); }
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('blur', finish);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('blur', finish);
  });
  document.getElementById('share-selection-toolbar').addEventListener('submit', event => {
    const selected = checks.filter(check => check.checked).length;
    if (!selected || selected > 500) event.preventDefault();
  });
  update();
});
