(() => {
  const STORAGE_KEY = 'harbor-drive-list-sort';
  const headers = document.querySelectorAll('.drive-list-header, .share-list-header');
  if (!headers.length) return;

  const columnNames = { name: 'name', size: 'size', modified: 'modified date' };

  function readState() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (raw && (raw.key === 'name' || raw.key === 'size' || raw.key === 'modified') && (raw.dir === 'asc' || raw.dir === 'desc')) {
        return raw;
      }
    } catch {
      // Storage may be unavailable in restricted/private browser contexts.
    }
    return null;
  }

  function writeState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage may be unavailable in restricted/private browser contexts.
    }
  }

  function valueFor(item, key) {
    if (key === 'size') return Number(item.dataset.size || 0);
    if (key === 'modified') return Number(item.dataset.sortModified || 0);
    return (item.dataset.name || '').trim();
  }

  function compare(a, b, key, dir) {
    const av = valueFor(a, key);
    const bv = valueFor(b, key);
    let result = typeof av === 'number' && typeof bv === 'number'
      ? av - bv
      : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' });
    if (result === 0 && key !== 'name') {
      result = String(valueFor(a, 'name')).localeCompare(String(valueFor(b, 'name')), undefined, { numeric: true, sensitivity: 'base' });
    }
    return dir === 'desc' ? -result : result;
  }

  function itemSelector() {
    return document.querySelector('.share-public') ? '.share-item-card' : '.grid-item';
  }

  function sortGroups(state) {
    const selector = itemSelector();
    document.querySelectorAll('.drive-items-group, .share-card-grid').forEach(group => {
      const items = Array.from(group.querySelectorAll(selector));
      items.sort((a, b) => compare(a, b, state.key, state.dir));
      items.forEach(item => group.append(item));
    });
  }

  function defaultDir(key) {
    return key === 'name' ? 'asc' : 'desc';
  }

  function buttonLabel(key, state) {
    const column = columnNames[key] || key;
    if (!state || state.key !== key) return `Sort by ${column}`;
    const current = state.dir === 'asc' ? 'ascending' : 'descending';
    const next = state.dir === 'asc' ? 'descending' : 'ascending';
    return `Sort by ${column}, currently ${current}. Activate to sort ${next}`;
  }

  function syncButtons(state) {
    headers.forEach(header => {
      header.querySelectorAll('[data-sort]').forEach(btn => {
        const key = btn.dataset.sort;
        const active = Boolean(state) && state.key === key;
        const icon = btn.querySelector('i');
        btn.setAttribute('aria-pressed', String(active));
        btn.setAttribute('aria-sort', active ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none');
        btn.setAttribute('aria-label', buttonLabel(key, state));
        btn.title = buttonLabel(key, state);
        if (icon) {
          icon.className = `bi ${active ? (state.dir === 'asc' ? 'bi-caret-up-fill' : 'bi-caret-down-fill') : 'bi-arrow-down-up'}`;
        }
      });
    });
  }

  function apply(state) {
    syncButtons(state);
    if (state) sortGroups(state);
  }

  let state = readState();
  apply(state);

  headers.forEach(header => {
    header.addEventListener('click', event => {
      const btn = event.target.closest('[data-sort]');
      if (!btn) return;
      event.preventDefault();
      event.stopPropagation();
      const key = btn.dataset.sort;
      state = state && state.key === key
        ? { key, dir: state.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: defaultDir(key) };
      writeState(state);
      apply(state);
    });
  });
})();
