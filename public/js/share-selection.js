document.addEventListener('DOMContentLoaded', () => {
  const SHARE_LAYOUT_KEY = 'harbor-drive-layout';
  const sharePage = document.querySelector('.share-public--folder');
  const layoutListBtn = document.getElementById('layout-list-btn');
  const layoutGridBtn = document.getElementById('layout-grid-btn');

  function applyShareLayout(layout) {
    if (!sharePage) return;
    const resolvedLayout = layout === 'list' ? 'list' : 'grid';
    sharePage.classList.toggle('share-layout-list', resolvedLayout === 'list');
    sharePage.classList.toggle('share-layout-grid', resolvedLayout === 'grid');
    layoutListBtn?.setAttribute('aria-pressed', String(resolvedLayout === 'list'));
    layoutGridBtn?.setAttribute('aria-pressed', String(resolvedLayout === 'grid'));
    try {
      localStorage.setItem(SHARE_LAYOUT_KEY, resolvedLayout);
    } catch {
      // Storage may be unavailable in restricted/private browser contexts.
    }
  }

  if (layoutListBtn && layoutGridBtn) {
    let savedShareLayout = 'grid';
    try {
      savedShareLayout = localStorage.getItem(SHARE_LAYOUT_KEY) || 'grid';
    } catch {
      savedShareLayout = 'grid';
    }
    applyShareLayout(savedShareLayout);
    layoutListBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      applyShareLayout('list');
    });
    layoutGridBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      applyShareLayout('grid');
    });
  }

  const area = document.querySelector('.share-public--folder .share-main');
  if (!area || !document.getElementById('share-selection-toolbar')) return;
  const liveCards = () => Array.from(area.querySelectorAll('.share-item-card'));
  const checkFor = card => card.querySelector('input[type="checkbox"]');
  const cards = liveCards();
  const all = document.getElementById('share-select-all');
  const count = document.getElementById('share-selection-count');
  const download = document.getElementById('share-download-selected');
  const toolbar = document.getElementById('share-selection-toolbar');
  // Keep the floating bar outside the animated main element, whose transform
  // would otherwise make a fixed element scroll with the document.
  area.closest('.share-page').append(toolbar);
  let anchorCard = cards[0] || null;
  let suppressClick = false;
  const update = () => {
    const selected = cards.filter(card => checkFor(card).checked).length;
    toolbar.hidden = selected === 0;
    cards.forEach(card => card.classList.toggle('is-selected', checkFor(card).checked));
    all.checked = selected === cards.length && selected > 0;
    all.indeterminate = selected > 0 && selected < cards.length;
    count.textContent = selected ? `${selected} item${selected === 1 ? '' : 's'} selected` : 'No items selected';
    if (selected > 500) count.textContent = `${selected} items selected. Select up to 500 per download.`;
    if (download) download.disabled = selected === 0 || selected > 500;
  };
  all.addEventListener('change', () => { cards.forEach(card => { checkFor(card).checked = all.checked; }); update(); });
  area.addEventListener('change', update);
  area.closest('.share-page').addEventListener('click', event => {
    if (suppressClick || event.target.closest('.share-item-card, a, button, input, label, form')) return;
    cards.forEach(card => { checkFor(card).checked = false; });
    update();
  });
  cards.forEach(card => {
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
      const ordered = liveCards();
      const index = ordered.indexOf(card);
      if (event.shiftKey) {
        const anchorIndex = Math.max(0, ordered.indexOf(anchorCard));
        const start = Math.min(anchorIndex, index);
        const end = Math.max(anchorIndex, index);
        ordered.forEach((item, i) => { checkFor(item).checked = i >= start && i <= end; });
      } else if (event.ctrlKey || event.metaKey) {
        checkFor(card).checked = !checkFor(card).checked;
      } else {
        const next = !checkFor(card).checked;
        cards.forEach(item => { checkFor(item).checked = false; });
        checkFor(card).checked = next;
      }
      anchorCard = card;
      update();
    });
  });
  area.closest('.share-page').addEventListener('keydown', event => {
    if (event.key === 'Escape') { cards.forEach(card => { checkFor(card).checked = false; }); update(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault(); cards.forEach(card => { checkFor(card).checked = true; }); update();
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
    const previous = new Map(cards.map(card => [card, checkFor(card).checked]));
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
      liveCards().forEach(card => {
        const rect = card.getBoundingClientRect();
        const hit = rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top;
        checkFor(card).checked = hit || (additive && previous.get(card));
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
    const selected = cards.filter(card => checkFor(card).checked).length;
    if (!selected || selected > 500) event.preventDefault();
  });
  update();
});
