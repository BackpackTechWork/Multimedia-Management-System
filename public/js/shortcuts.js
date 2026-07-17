document.addEventListener('DOMContentLoaded', () => {
  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
  const DRIVE_CLIPBOARD_KEY = 'harbor-drive-clipboard';

  let clipboard = {
    action: null,
    items: []
  };

  try {
    const storedClipboard = JSON.parse(sessionStorage.getItem(DRIVE_CLIPBOARD_KEY) || 'null');
    if (
      storedClipboard &&
      ['copy', 'cut'].includes(storedClipboard.action) &&
      Array.isArray(storedClipboard.items)
    ) {
      clipboard = {
        action: storedClipboard.action,
        items: storedClipboard.items.filter(item => item && item.id && item.type)
      };
    }
  } catch {
    clipboard = { action: null, items: [] };
  }

  function persistClipboard() {
    try {
      if (clipboard.action && clipboard.items.length > 0) {
        sessionStorage.setItem(DRIVE_CLIPBOARD_KEY, JSON.stringify(clipboard));
      } else {
        sessionStorage.removeItem(DRIVE_CLIPBOARD_KEY);
      }
    } catch {
      // Clipboard persistence is best-effort; keyboard actions still work on this page.
    }
  }

  function refreshClipboardFromStorage() {
    try {
      const storedClipboard = JSON.parse(sessionStorage.getItem(DRIVE_CLIPBOARD_KEY) || 'null');
      if (
        storedClipboard &&
        ['copy', 'cut'].includes(storedClipboard.action) &&
        Array.isArray(storedClipboard.items)
      ) {
        clipboard = {
          action: storedClipboard.action,
          items: storedClipboard.items.filter(item => item && item.id && item.type)
        };
      }
    } catch {
      // Keep the in-memory clipboard if storage cannot be read.
    }
  }

  let awaitingSequenceKey = false;
  let sequenceTimeoutId = null;

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      awaitingSequenceKey = false;
      clearTimeout(sequenceTimeoutId);

      const openModals = document.querySelectorAll('.fixed.inset-0:not(.hidden)');
      openModals.forEach(m => m.classList.add('hidden'));

      const progressModal = document.getElementById('upload-progress-modal');
      if (progressModal) progressModal.classList.add('hidden');

      if (window.clearSelection) {
        window.clearSelection();
      }
      return;
    }

    const activeElement = document.activeElement;
    if (activeElement && (
      activeElement.tagName === 'INPUT' || 
      activeElement.tagName === 'TEXTAREA' || 
      activeElement.contentEditable === 'true'
    )) {
      return;
    }

    if (awaitingSequenceKey) {
      const key = e.key.toLowerCase();
      if (['f', 'u', 'i'].includes(key)) {
        e.preventDefault();
        e.stopPropagation();
        awaitingSequenceKey = false;
        clearTimeout(sequenceTimeoutId);

        if (key === 'f') {
          const openModalBtn = document.getElementById('new-folder-modal-btn');
          if (openModalBtn) openModalBtn.click();
        } else if (key === 'u') {
          const uploadInput = document.getElementById('upload-input');
          if (uploadInput) uploadInput.click();
        } else if (key === 'i') {
          const folderUploadInput = document.getElementById('folder-upload-input');
          if (folderUploadInput) folderUploadInput.click();
        }
        return;
      } else {
        awaitingSequenceKey = false;
        clearTimeout(sequenceTimeoutId);
      }
    }

    if (e.altKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      e.stopPropagation();
      awaitingSequenceKey = true;
      clearTimeout(sequenceTimeoutId);
      sequenceTimeoutId = setTimeout(() => {
        awaitingSequenceKey = false;
      }, 2000);
      return;
    }

    const selected = window.selectedItems ? window.selectedItems() : [];

    if (e.shiftKey && e.key.toUpperCase() === 'U') {
      e.preventDefault();
      const uploadInput = document.getElementById('upload-input');
      if (uploadInput) uploadInput.click();
    }

    if (e.shiftKey && e.key.toUpperCase() === 'F') {
      e.preventDefault();
      const openModalBtn = document.getElementById('new-folder-modal-btn');
      if (openModalBtn) openModalBtn.click();
    }

    if (e.key === 'Delete') {
      e.preventDefault();
      if (selected.length > 0) {
        triggerDelete(selected);
      }
    }

    if (e.key === 'F2') {
      e.preventDefault();
      if (selected.length > 0) {
        triggerRename(selected[0]);
      }
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      if (window.selectAllDriveItems) {
        window.selectAllDriveItems();
      }
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
      if (selected.length > 0) {
        e.preventDefault();
        copySelection();
      }
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
      if (selected.length > 0) {
        e.preventDefault();
        cutSelection();
      }
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      handlePaste();
    }

    if (e.key === 'Enter') {
      if (selected.length > 0) {
        e.preventDefault();
        const dblclickEvent = new MouseEvent('dblclick', { bubbles: true, cancelable: true });
        selected[0].dispatchEvent(dblclickEvent);
      }
    }


  });

  window.driveClipboard = {
    copySelection,
    cutSelection,
    paste: handlePaste,
    hasItems: () => clipboard.items.length > 0,
    getState: () => ({ action: clipboard.action, items: [...clipboard.items] })
  };

  function getSelectedPayload() {
    if (window.getDriveSelectionPayload) {
      return window.getDriveSelectionPayload();
    }

    const selected = window.selectedItems ? window.selectedItems() : [];
    return selected.map(el => ({
      id: el.dataset.id,
      type: el.dataset.type,
      name: el.dataset.name || el.dataset.type
    }));
  }

  function setClipboard(action) {
    const items = getSelectedPayload();
    if (items.length === 0) {
      showNotification('Select at least one item first');
      return false;
    }

    clipboard = { action, items };
    persistClipboard();
    document.querySelectorAll('.grid-item.is-cut-pending').forEach(item => {
      item.classList.remove('is-cut-pending');
    });

    if (action === 'cut') {
      const selected = window.selectedItems ? window.selectedItems() : [];
      selected.forEach(item => item.classList.add('is-cut-pending'));
      showNotification(`${items.length} item(s) ready to move`, 'info', 7000);
    } else {
      showNotification(`${items.length} item(s) copied`, 'info', 6000);
    }

    return true;
  }

  function copySelection() {
    return setClipboard('copy');
  }

  function cutSelection() {
    if (window.driveContext?.tab === 'trash') {
      showNotification('Cut is not available in trash');
      return false;
    }

    return setClipboard('cut');
  }

  async function handlePaste() {
    refreshClipboardFromStorage();

    if (clipboard.items.length === 0) {
      showNotification('Clipboard is empty');
      return;
    }

    if (window.driveContext?.tab === 'trash') {
      showNotification('Paste is not available in trash');
      return;
    }

    if (window.driveContext?.currentFolderCanEdit === false || window.driveContext?.currentFolderCanEdit === 'false') {
      showNotification('Editor access is required to paste here');
      return;
    }

    const currentFolderId = window.getCurrentFolderId ? window.getCurrentFolderId() : '';
    const isCopy = clipboard.action === 'copy';
    const actionRoute = isCopy ? 'copy' : 'move';
    const completedItems = [];
    
    showNotification(`Pasting ${clipboard.items.length} item(s)...`, 'info', 7000);

    for (let item of clipboard.items) {
      const url = `/api/${item.type}s/${actionRoute}`;
      const payload = {};
      
      if (item.type === 'folder') {
        payload.folderId = item.id;
        payload.destinationFolderId = currentFolderId;
      } else {
        payload.fileId = item.id;
        payload.destinationFolderId = currentFolderId;
      }

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': csrfToken
          },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Failed to ${actionRoute} ${item.name || item.type}`);
        }
        completedItems.push(item);
      } catch (err) {
        console.error(err);
        showNotification(err.message || 'Paste action failed', 'error', 7000);
        return;
      }
    }

    if (!isCopy) {
      clipboard = { action: null, items: [] };
      persistClipboard();
      document.querySelectorAll('.grid-item.is-cut-pending').forEach(item => {
        item.classList.remove('is-cut-pending');
      });
    }

    window.queueDriveToast?.(`${completedItems.length} item(s) pasted`, 'success', 7000);
    window.location.reload();
  }

  async function triggerDelete(selectedElements) {
    if (window.driveContext?.tab === 'trash') {
      if (window.purgeSelected) {
        await window.purgeSelected(selectedElements);
      }
      return;
    }

    if (window.moveSelectedToTrash) {
      await window.moveSelectedToTrash(selectedElements);
      return;
    }

    alert('Delete action is not available yet. Please refresh the page and try again.');
  }

  async function triggerRename(element) {
    const id = element.dataset.id;
    const type = element.dataset.type;
    const currentName = element.dataset.name;
    const newName = await prompt(`Rename ${type}:`, currentName);

    if (newName && newName.trim() !== '' && newName !== currentName) {
      fetch(`/api/${type}s/rename`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken
        },
        body: JSON.stringify({ id, name: newName })
      })
      .then(res => {
        if (res.ok) {
          window.queueDriveToast?.('Renamed successfully', 'success');
          window.location.reload();
        } else {
          showNotification('Rename failed', 'error');
        }
      })
      .catch(() => {
        showNotification('Rename failed', 'error');
      });
    }
  }

  function showNotification(text, type = 'info', duration = 5200) {
    if (window.showDriveToast) {
      window.showDriveToast(text, type, duration);
      return;
    }

    const toast = document.createElement('div');
    toast.className = 'fixed bottom-4 right-4 bg-gray-800 text-white px-4 py-2 rounded-lg shadow-lg z-50 text-sm';
    toast.textContent = text;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.2s';
      setTimeout(() => toast.remove(), 200);
    }, duration);
  }
});
