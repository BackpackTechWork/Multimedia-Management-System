document.addEventListener('DOMContentLoaded', () => {
  const area = document.querySelector('.share-public--folder .share-main');
  if (!area || !document.getElementById('share-selection-toolbar')) return;
  const cards = Array.from(area.querySelectorAll('.share-item-card'));
  const checks = cards.map(card => card.querySelector('input[type="checkbox"]'));
  const all = document.getElementById('share-select-all');
  const count = document.getElementById('share-selection-count');
  const download = document.getElementById('share-download-selected');
  const toolbar = document.getElementById('share-selection-toolbar');
  // Keep the floating bar outside the animated main element, whose transform
  // would otherwise make a fixed element scroll with the document.
  area.closest('.share-page').append(toolbar);
  let anchor = 0;
  let suppressClick = false;
  const update = () => {
    const selected = checks.filter(check => check.checked).length;
    toolbar.hidden = selected === 0;
    cards.forEach((card, index) => card.classList.toggle('is-selected', checks[index].checked));
    all.checked = selected === checks.length && selected > 0;
    all.indeterminate = selected > 0 && selected < checks.length;
    count.textContent = selected ? `${selected} item${selected === 1 ? '' : 's'} selected` : 'No items selected';
    if (selected > 500) count.textContent = `${selected} items selected. Select up to 500 per download.`;
    if (download) download.disabled = selected === 0 || selected > 500;
  };
  all.addEventListener('change', () => { checks.forEach(check => { check.checked = all.checked; }); update(); });
  area.addEventListener('change', update);
  area.closest('.share-page').addEventListener('click', event => {
    if (suppressClick || event.target.closest('.share-item-card, a, button, input, label, form')) return;
    checks.forEach(check => { check.checked = false; });
    update();
  });
  cards.forEach((card, index) => {
    card.addEventListener('dblclick', event => {
      if (!suppressClick && card.dataset.openUrl && !event.target.closest('a, button, input, label')) window.location.href = card.dataset.openUrl;
    });
    card.addEventListener('keydown', event => {
      if (event.target === card && (event.key === ' ' || event.key === 'Enter')) {
        event.preventDefault();
        if (event.key === 'Enter' && card.dataset.openUrl) window.location.href = card.dataset.openUrl;
        else card.click();
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
  area.closest('.share-page').addEventListener('keydown', event => {
    if (event.key === 'Escape') { checks.forEach(check => { check.checked = false; }); update(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault(); checks.forEach(check => { check.checked = true; }); update();
    }
  });
  area.closest('.share-page').addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.pointerType === 'touch' || event.target.closest('header, a, button, input, label, form')) return;
    event.preventDefault();
    event.target.closest('.share-item-card')?.focus({ preventScroll: true });
    document.body.classList.add('share-drag-selecting');
    window.getSelection()?.removeAllRanges();
    const start = { x: event.clientX + window.scrollX, y: event.clientY + window.scrollY };
    const pointer = { x: event.clientX, y: event.clientY };
    const previous = checks.map(check => check.checked);
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    let box;
    let frame;
    let lastFrame;
    const draw = () => {
      if (!box) return;
      const anchorX = start.x - window.scrollX, anchorY = start.y - window.scrollY;
      const left = Math.min(anchorX, pointer.x), top = Math.min(anchorY, pointer.y);
      const right = Math.max(anchorX, pointer.x), bottom = Math.max(anchorY, pointer.y);
      Object.assign(box.style, { left: `${left}px`, top: `${top}px`, width: `${right-left}px`, height: `${bottom-top}px` });
      cards.forEach((card, i) => {
        const rect = card.getBoundingClientRect();
        const hit = rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top;
        checks[i].checked = hit || (additive && previous[i]);
      });
      update();
    };
    const autoScroll = time => {
      const elapsed = Math.min(32, lastFrame === undefined ? 16 : time - lastFrame);
      lastFrame = time;
      const edge = 96;
      const direction = pointer.y > window.innerHeight - edge
        ? Math.min(1, (pointer.y - (window.innerHeight - edge)) / edge)
        : pointer.y < edge ? -Math.min(1, (edge - pointer.y) / edge) : 0;
      if (direction) window.scrollBy({ top: direction * elapsed * 0.9, behavior: 'instant' });
      draw();
      frame = window.requestAnimationFrame(autoScroll);
    };
    const move = e => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      if (!box && Math.hypot(pointer.x + window.scrollX - start.x, pointer.y + window.scrollY - start.y) < 5) return;
      e.preventDefault();
      if (!box) {
        box = document.createElement('div');
        box.className = 'share-selection-box';
        document.body.append(box);
        frame = window.requestAnimationFrame(autoScroll);
      }
      draw();
    };
    const finish = () => {
      window.cancelAnimationFrame(frame);
      document.body.classList.remove('share-drag-selecting');
      if (box) { box.remove(); suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); }
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('blur', finish);
      window.removeEventListener('scroll', draw);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('blur', finish);
    window.addEventListener('scroll', draw, { passive: true });
  });
  document.getElementById('share-selection-toolbar').addEventListener('submit', event => {
    const selected = checks.filter(check => check.checked).length;
    if (!selected || selected > 500) event.preventDefault();
  });
  update();
});
