document.addEventListener('DOMContentLoaded', () => {
  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');

  let clipboard = {
    action: null,
    items: []
  };

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();

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
      const gridItems = document.querySelectorAll('.grid-item');
      gridItems.forEach(item => {
        if (window.selectedItems) {
          item.classList.add('selected');
        }
      });
      if (window.selectedItems && gridItems.length > 0) {
        gridItems[0].click();
      }
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
      if (selected.length > 0) {
        e.preventDefault();
        clipboard = {
          action: 'copy',
          items: selected.map(el => ({ id: el.dataset.id, type: el.dataset.type }))
        };
        showNotification('Copied to clipboard');
      }
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
      if (selected.length > 0) {
        e.preventDefault();
        clipboard = {
          action: 'cut',
          items: selected.map(el => ({ id: el.dataset.id, type: el.dataset.type }))
        };
        showNotification('Cut items to clipboard (ready to move)');
      }
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      if (clipboard.items.length > 0) {
        handlePaste();
      }
    }

    if (e.key === 'Enter') {
      if (selected.length > 0) {
        e.preventDefault();
        const dblclickEvent = new MouseEvent('dblclick', { bubbles: true, cancelable: true });
        selected[0].dispatchEvent(dblclickEvent);
      }
    }


  });

  async function handlePaste() {
    const currentFolderId = window.getCurrentFolderId ? window.getCurrentFolderId() : '';
    const isCopy = clipboard.action === 'copy';
    const actionRoute = isCopy ? 'copy' : 'move';
    
    showNotification(`Pasting ${clipboard.items.length} item(s)...`);

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
          throw new Error('Paste action failed');
        }
      } catch (err) {
        console.error(err);
      }
    }

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
          window.location.reload();
        } else {
          alert('Rename failed');
        }
      });
    }
  }

  function showNotification(text) {
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-4 right-4 bg-gray-800 text-white px-4 py-2 rounded-lg shadow-lg z-50 text-sm';
    toast.textContent = text;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.2s';
      setTimeout(() => toast.remove(), 200);
    }, 2500);
  }
});
