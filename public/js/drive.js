// Main Drive client interactions and chunked uploader
window.getCurrentFolderId = function() {
  if (window.driveContext && window.driveContext.currentFolderId) {
    return window.driveContext.currentFolderId;
  }

  const folderMatch = window.location.pathname.match(/^\/folders\/(\d+)\/?$/);
  if (folderMatch) return folderMatch[1];

  return '';
};

window.playNotificationSound = function() {
  return new Promise((resolve) => {
    const audio = new Audio('/sounds/Notification%20Sound.mp3');
    audio.addEventListener('ended', resolve);
    audio.addEventListener('error', resolve);
    audio.play().catch(err => {
      console.warn('Audio play failed:', err);
      resolve();
    });
    setTimeout(resolve, 2500);
  });
};

document.addEventListener('DOMContentLoaded', () => {
  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
  const currentTab = window.driveContext?.tab || 'my-drive';
  const isTrashTab = currentTab === 'trash';
  
  // --- CLICK-BASED DROPDOWNS & SIDEBAR ACTIONS ---
  const newDropdownBtn = document.getElementById('new-dropdown-btn');
  const newDropdownMenu = document.getElementById('new-dropdown-menu');
  const profileDropdownBtn = document.getElementById('profile-dropdown-btn');
  const profileDropdownMenu = document.getElementById('profile-dropdown-menu');
  const mobileSidebarToggle = document.getElementById('mobile-sidebar-toggle');
  const mobileSidebarClose = document.getElementById('mobile-sidebar-close');
  const driveSidebar = document.getElementById('drive-sidebar');
  const driveSidebarBackdrop = document.getElementById('drive-sidebar-backdrop');

  function isMobileSidebar() {
    return window.matchMedia('(max-width: 1023px)').matches;
  }

  function openSidebar() {
    if (!driveSidebar || !driveSidebarBackdrop) return;

    driveSidebar.classList.add('is-open');
    driveSidebarBackdrop.classList.add('is-open');
    document.body.classList.add('sidebar-open');
    if (mobileSidebarToggle) mobileSidebarToggle.setAttribute('aria-expanded', 'true');
  }

  function closeSidebar() {
    if (!driveSidebar || !driveSidebarBackdrop) return;

    driveSidebar.classList.remove('is-open');
    driveSidebarBackdrop.classList.remove('is-open');
    document.body.classList.remove('sidebar-open');
    if (mobileSidebarToggle) mobileSidebarToggle.setAttribute('aria-expanded', 'false');
  }

  if (mobileSidebarToggle) {
    mobileSidebarToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (driveSidebar && driveSidebar.classList.contains('is-open')) closeSidebar();
      else openSidebar();
    });
  }

  if (mobileSidebarClose) {
    mobileSidebarClose.addEventListener('click', (e) => {
      e.stopPropagation();
      closeSidebar();
    });
  }

  if (driveSidebarBackdrop) {
    driveSidebarBackdrop.addEventListener('click', closeSidebar);
  }

  if (driveSidebar) {
    driveSidebar.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        if (isMobileSidebar()) closeSidebar();
      });
    });
  }

  window.addEventListener('resize', () => {
    if (!isMobileSidebar()) closeSidebar();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && driveSidebar?.classList.contains('is-open')) {
      closeSidebar();
    }
  });

  if (newDropdownBtn && newDropdownMenu) {
    newDropdownBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      newDropdownMenu.classList.toggle('hidden');
      if (profileDropdownMenu) profileDropdownMenu.classList.add('hidden');
    });
  }

  if (profileDropdownBtn && profileDropdownMenu) {
    profileDropdownBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      profileDropdownMenu.classList.toggle('hidden');
      if (newDropdownMenu) newDropdownMenu.classList.add('hidden');
    });
  }

  // Sidebar upload button
  const sidebarUploadBtn = document.getElementById('sidebar-upload-btn');
  if (sidebarUploadBtn) {
    sidebarUploadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (newDropdownMenu) newDropdownMenu.classList.add('hidden');
      const uploadInput = document.getElementById('upload-input');
      if (uploadInput) uploadInput.click();
    });
  }

  // Sidebar new folder button
  const sidebarNewFolderBtn = document.getElementById('new-folder-modal-btn');
  if (sidebarNewFolderBtn) {
    sidebarNewFolderBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (newDropdownMenu) newDropdownMenu.classList.add('hidden');
      const modal = document.getElementById('new-folder-modal');
      if (modal) {
        modal.classList.remove('hidden');
        const input = document.getElementById('new-folder-name');
        if (input) {
          input.value = '';
          input.focus();
        }
      }
    });
  }
  
  // Selection state
  let selectedItems = []; // Array of elements currently selected
  const items = document.querySelectorAll('.grid-item');
  const detailsAside = document.getElementById('details-aside');
  const detailsPane = document.getElementById('details-pane');
  const trashSelectionActions = document.getElementById('trash-selection-actions');
  const trashSelectionCount = document.getElementById('trash-selection-count');
  let justDragged = false;

  // Custom Context Menu Overlay
  const contextMenu = document.createElement('div');
  contextMenu.id = 'custom-context-menu';
  contextMenu.className = 'fixed bg-white border border-gray-200 rounded-xl shadow-xl py-1.5 w-56 z-[9999] hidden select-none text-gray-700 text-sm font-semibold transition-all duration-100';
  contextMenu.innerHTML = `
    <button id="context-open" class="w-full text-left px-4 py-2 hover:bg-gray-100 flex items-center gap-3 transition duration-150">
      <i class="bi bi-folder2-open text-gray-500 text-base"></i>
      <span>Open</span>
    </button>
    <div class="h-px bg-gray-200 my-1"></div>
    <button id="context-download" class="w-full text-left px-4 py-2 hover:bg-gray-100 flex items-center gap-3 transition duration-150">
      <i class="bi bi-download text-gray-500 text-base"></i>
      <span>Download</span>
    </button>
    <button id="context-rename" class="w-full text-left px-4 py-2 hover:bg-gray-100 flex items-center gap-3 transition duration-150">
      <i class="bi bi-pencil text-gray-500 text-base"></i>
      <span>Rename</span>
    </button>
    <button id="context-copy" class="w-full text-left px-4 py-2 hover:bg-gray-100 flex items-center gap-3 transition duration-150">
      <i class="bi bi-file-earmark-medical text-gray-500 text-base"></i>
      <span>Make a copy</span>
    </button>
    <div class="h-px bg-gray-200 my-1"></div>
    <button id="context-share" class="w-full text-left px-4 py-2 hover:bg-gray-100 flex items-center gap-3 transition duration-150">
      <i class="bi bi-share text-gray-500 text-base"></i>
      <span>Share</span>
    </button>
    <button id="context-move" class="w-full text-left px-4 py-2 hover:bg-gray-100 flex items-center gap-3 transition duration-150">
      <i class="bi bi-folder-symlink text-gray-500 text-base"></i>
      <span>Move to</span>
    </button>
    <button id="context-properties" class="w-full text-left px-4 py-2 hover:bg-gray-100 flex items-center gap-3 transition duration-150">
      <i class="bi bi-info-circle text-gray-500 text-base"></i>
      <span>Properties</span>
    </button>
    <div class="h-px bg-gray-200 my-1"></div>
    <button id="context-delete" class="w-full text-left px-4 py-2 hover:bg-gray-100 text-red-600 flex items-center gap-3 transition duration-150">
      <i class="bi bi-trash text-red-500 text-base"></i>
      <span>${isTrashTab ? 'Delete permanently' : 'Move to bin'}</span>
    </button>
  `;
  document.body.appendChild(contextMenu);

  const toolbarDeleteBtn = document.getElementById('detail-delete-btn');
  if (toolbarDeleteBtn && isTrashTab) {
    toolbarDeleteBtn.title = 'Delete permanently';
    toolbarDeleteBtn.classList.add('text-red-600');
  }

  // Close button for the details aside panel (now just hides, doesn't clear selection)
  const closeDetailsBtn = document.getElementById('close-details-btn');
  if (closeDetailsBtn) {
    closeDetailsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (detailsAside) detailsAside.classList.add('details-aside--hidden');
    });
  }

  // --- SELECTION UTILITIES ---
  function clearSelection() {
    items.forEach(item => item.classList.remove('selected'));
    selectedItems = [];
    updateDetailsPane();
  }

  function selectItem(element, append = false) {
    if (!append) {
      clearSelection();
    }
    element.classList.add('selected');
    if (!selectedItems.includes(element)) {
      selectedItems.push(element);
    }
    updateDetailsPane();
  }

  function deselectItem(element) {
    element.classList.remove('selected');
    selectedItems = selectedItems.filter(el => el !== element);
    updateDetailsPane();
  }

  function updateTrashSelectionActions() {
    if (!trashSelectionActions) return;

    const count = selectedItems.length;
    trashSelectionActions.classList.toggle('hidden', count === 0);
    trashSelectionActions.classList.toggle('flex', count > 0);

    if (trashSelectionCount) {
      const itemLabel = count === 1 ? 'item' : 'items';
      trashSelectionCount.textContent = `${count} ${itemLabel} selected`;
    }
  }

  // Handle single clicks on item cards
  items.forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      contextMenu.classList.add('hidden');
      if (e.ctrlKey || e.metaKey) {
        if (item.classList.contains('selected')) {
          deselectItem(item);
        } else {
          selectItem(item, true);
        }
      } else if (e.shiftKey && selectedItems.length > 0) {
        // Simple range selection between first selected item and current item
        const firstSelected = selectedItems[0];
        const allGridItems = Array.from(document.querySelectorAll('.grid-item'));
        const idx1 = allGridItems.indexOf(firstSelected);
        const idx2 = allGridItems.indexOf(item);
        const start = Math.min(idx1, idx2);
        const end = Math.max(idx1, idx2);
        
        clearSelection();
        for (let i = start; i <= end; i++) {
          selectItem(allGridItems[i], true);
        }
      } else {
        selectItem(item, false);
      }
    });

    // Double click to open folders or preview files
    item.addEventListener('dblclick', () => {
      const type = item.dataset.type;
      const id = item.dataset.id;
      if (type === 'folder') {
        if (!window.driveContext || window.driveContext.tab === 'my-drive') {
          window.location.href = `/folders/${id}`;
        }
      } else {
        // Preview file
        const mime = item.dataset.mime || '';
        let route = 'code';
        if (mime.startsWith('image/')) route = 'image';
        else if (mime === 'application/pdf') route = 'pdf';
        else if (mime.startsWith('video/')) route = 'video';
        else if (mime.startsWith('audio/')) route = 'audio';
        else if (item.dataset.ext === 'md') route = 'markdown';
        else if (['xls', 'xlsx', 'csv', 'ods'].includes(item.dataset.ext)) route = 'excel';
        
        window.open(`/preview/${route}/${id}`, '_blank');
      }
    });

    // Right click for context menu
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (!selectedItems.includes(item)) {
        selectItem(item, false);
      }

      // Position and show custom context menu
      const menuWidth = 224;
      const menuHeight = 280;
      let posX = e.clientX;
      let posY = e.clientY;

      if (posX + menuWidth > window.innerWidth) {
        posX = window.innerWidth - menuWidth - 10;
      }
      if (posY + menuHeight > window.innerHeight) {
        posY = window.innerHeight - menuHeight - 10;
      }

      contextMenu.style.left = posX + 'px';
      contextMenu.style.top = posY + 'px';
      contextMenu.classList.remove('hidden');
    });
  });

  // Event handlers for context menu items
  document.getElementById('context-open').addEventListener('click', (e) => {
    e.stopPropagation();
    const selected = selectedItems[0];
    if (selected) {
      selected.dispatchEvent(new Event('dblclick'));
    }
    contextMenu.classList.add('hidden');
  });

  document.getElementById('context-download').addEventListener('click', (e) => {
    e.stopPropagation();
    const btn = document.getElementById('detail-download-btn');
    if (btn) btn.click();
    contextMenu.classList.add('hidden');
  });

  document.getElementById('context-rename').addEventListener('click', (e) => {
    e.stopPropagation();
    const btn = document.getElementById('detail-rename-btn');
    if (btn) btn.click();
    contextMenu.classList.add('hidden');
  });

  document.getElementById('context-copy').addEventListener('click', (e) => {
    e.stopPropagation();
    const btn = document.getElementById('detail-copy-btn');
    if (btn) btn.click();
    contextMenu.classList.add('hidden');
  });

  document.getElementById('context-share').addEventListener('click', (e) => {
    e.stopPropagation();
    const btn = document.getElementById('detail-share-btn');
    if (btn) btn.click();
    contextMenu.classList.add('hidden');
  });

  document.getElementById('context-move').addEventListener('click', (e) => {
    e.stopPropagation();
    const btn = document.getElementById('detail-move-btn');
    if (btn) btn.click();
    contextMenu.classList.add('hidden');
  });

  document.getElementById('context-properties').addEventListener('click', (e) => {
    e.stopPropagation();
    if (detailsAside) {
      detailsAside.classList.remove('details-aside--hidden');
    }
    contextMenu.classList.add('hidden');
  });

  document.getElementById('context-delete').addEventListener('click', (e) => {
    e.stopPropagation();
    const btn = document.getElementById('detail-delete-btn');
    if (btn) btn.click();
    contextMenu.classList.add('hidden');
  });

  async function applyTrashAction(action, selected, { confirmMessage, emptyMessage, failureMessage }) {
    if (!selected || selected.length === 0) {
      if (emptyMessage) alert(emptyMessage);
      return false;
    }

    if (confirmMessage && !await confirm(confirmMessage)) {
      return false;
    }

    const endpoint = `/api/trash/${action}`;
    const results = await Promise.all(selected.map(async (el) => {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken
        },
        body: JSON.stringify({ entityId: el.dataset.id, entityType: el.dataset.type })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || failureMessage || 'Trash action failed');
      }

      return el;
    }));

    results.forEach(el => el.remove());
    window.location.reload();
    return true;
  }

  window.moveSelectedToTrash = function(selectedOverride) {
    const selected = selectedOverride || (window.selectedItems ? window.selectedItems() : []);
    return applyTrashAction('move', selected, {
      confirmMessage: `Move ${selected.length} selected item(s) to trash?`,
      emptyMessage: 'Select at least one item first.',
      failureMessage: 'Move to trash failed'
    }).catch(err => {
      console.error(err);
      alert(err.message || 'Move to trash failed');
    });
  };

  window.restoreSelected = function(selectedOverride) {
    const selected = selectedOverride || (window.selectedItems ? window.selectedItems() : []);
    return applyTrashAction('restore', selected, {
      emptyMessage: 'Select at least one item to restore.',
      failureMessage: 'Restore failed'
    }).catch(err => {
      console.error(err);
      alert(err.message || 'Restore failed');
    });
  };

  window.purgeSelected = function(selectedOverride) {
    const selected = selectedOverride || (window.selectedItems ? window.selectedItems() : []);
    return applyTrashAction('purge', selected, {
      confirmMessage: 'Permanently delete selected item(s) from disk? This action CANNOT be undone.',
      emptyMessage: 'Select at least one item to delete permanently.',
      failureMessage: 'Permanent delete failed'
    }).catch(err => {
      console.error(err);
      alert(err.message || 'Permanent delete failed');
    });
  };

  const trashRestoreBtn = document.getElementById('trash-restore-selected-btn');
  if (trashRestoreBtn) {
    trashRestoreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.restoreSelected();
    });
  }

  const trashPurgeBtn = document.getElementById('trash-purge-selected-btn');
  if (trashPurgeBtn) {
    trashPurgeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.purgeSelected();
    });
  }

  // Clear selections and close dropdowns on clicking white spaces
  document.addEventListener('click', (e) => {
    if (justDragged) {
      justDragged = false;
      return;
    }
    clearSelection();
    if (newDropdownMenu) newDropdownMenu.classList.add('hidden');
    if (profileDropdownMenu) profileDropdownMenu.classList.add('hidden');
    contextMenu.classList.add('hidden');
  });

  document.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('.grid-item')) {
      contextMenu.classList.add('hidden');
    }
  });

  // --- DETAILS PANE RENDERER ---
  function updateDetailsPane() {
    updateTrashSelectionActions();

    if (selectedItems.length === 0) {
      // Hide the entire aside panel
      if (detailsAside) detailsAside.classList.add('details-aside--hidden');
      return;
    }
    
    // We do NOT show the aside panel automatically on normal selection changes now

    const first = selectedItems[0];
    const name = first.dataset.name;
    const type = first.dataset.type;
    const size = first.dataset.size;
    const updated = first.dataset.updated;
    const mime = first.dataset.mime || '';
    const ext = first.dataset.ext || '';
    const id = first.dataset.id;

    // Fill elements in details panel
    const detailName = document.getElementById('detail-name');
    const detailIcon = document.getElementById('detail-panel-icon');
    const detailType = document.getElementById('detail-type');
    const detailSize = document.getElementById('detail-size');
    const detailModified = document.getElementById('detail-modified');
    
    if (detailName) detailName.textContent = name;
    if (detailType) detailType.textContent = type === 'folder' ? 'Folder' : mime || 'Unknown';
    if (detailSize) detailSize.textContent = type === 'folder' ? '-' : formatBytes(size);
    if (detailModified) detailModified.textContent = updated;

    // Dynamically set the detail panel icon based on type/mime/extension
    if (detailIcon) {
      let iconClass = 'bi-file-earmark-text'; // default
      if (type === 'folder') {
        iconClass = 'bi-folder-fill';
      } else if (mime.startsWith('image/')) {
        iconClass = 'bi-file-image-fill';
      } else if (mime === 'application/pdf' || ext === 'pdf') {
        iconClass = 'bi-file-pdf-fill';
      } else if (['doc', 'docx'].includes(ext)) {
        iconClass = 'bi-file-word-fill';
      } else if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) {
        iconClass = 'bi-file-excel-fill';
      } else if (['js', 'ts', 'html', 'css', 'json', 'sql'].includes(ext)) {
        iconClass = 'bi-file-code-fill';
      } else if (ext === 'md') {
        iconClass = 'bi-markdown-fill';
      } else if (mime.startsWith('audio/')) {
        iconClass = 'bi-file-music-fill';
      } else if (mime.startsWith('video/')) {
        iconClass = 'bi-file-play-fill';
      } else if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
        iconClass = 'bi-file-zip-fill';
      }
      // Remove all existing bi-* icon classes and set the new one
      detailIcon.className = detailIcon.className.replace(/bi-[\w-]+/g, '').trim();
      detailIcon.classList.add(iconClass);
    }
    
    // Set up button actions dynamically based on selected ID/Type
    const deleteBtn = document.getElementById('detail-delete-btn');
    const starBtn = document.getElementById('detail-star-btn');
    const renameBtn = document.getElementById('detail-rename-btn');
    const shareBtn = document.getElementById('detail-share-btn');
    const moveBtn = document.getElementById('detail-move-btn');
    const downloadBtn = document.getElementById('detail-download-btn');
    const versionsBtn = document.getElementById('detail-versions-btn');

    // Display versions button only for files
    if (versionsBtn) {
      if (type === 'file') versionsBtn.classList.remove('hidden');
      else versionsBtn.classList.add('hidden');
    }

    if (deleteBtn) {
      deleteBtn.title = isTrashTab ? 'Delete permanently' : 'Move to Trash';
    }
  }

  function formatBytes(bytes) {
    if (!bytes || bytes == 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // --- BOX DRAG SELECTION ---
  const gridContainer = document.getElementById('items-grid-container');
  if (gridContainer) {
    let startClientX = 0, startClientY = 0, isSelecting = false;
    let box = null;

    gridContainer.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.target.closest('.grid-item') || e.target.closest('button') || e.target.closest('input')) return;
      e.preventDefault();
      
      startClientX = e.clientX;
      startClientY = e.clientY;
      isSelecting = true;
      clearSelection();

      box = document.createElement('div');
      box.className = 'selection-box';
      document.body.appendChild(box);
    });

    document.addEventListener('mousemove', (e) => {
      if (!isSelecting || !box) return;

      const currentClientX = e.clientX;
      const currentClientY = e.clientY;

      const boxLeft = Math.min(startClientX, currentClientX);
      const boxTop = Math.min(startClientY, currentClientY);
      const boxWidth = Math.abs(startClientX - currentClientX);
      const boxHeight = Math.abs(startClientY - currentClientY);

      box.style.left = (boxLeft + window.scrollX) + 'px';
      box.style.top = (boxTop + window.scrollY) + 'px';
      box.style.width = boxWidth + 'px';
      box.style.height = boxHeight + 'px';

      // Check collisions with grid items
      let changed = false;
      const newSelectedItems = [];
      
      items.forEach(item => {
        const itemRect = item.getBoundingClientRect();
        const intersect = !(itemRect.right < boxLeft || 
                            itemRect.left > boxLeft + boxWidth || 
                            itemRect.bottom < boxTop || 
                            itemRect.top > boxTop + boxHeight);
        
        const isSelected = item.classList.contains('selected');
        if (intersect) {
          if (!isSelected) {
            item.classList.add('selected');
            changed = true;
          }
          newSelectedItems.push(item);
        } else {
          if (isSelected) {
            item.classList.remove('selected');
            changed = true;
          }
        }
      });

      if (changed) {
        selectedItems = newSelectedItems;
        updateDetailsPane();
      }
    });

    document.addEventListener('mouseup', () => {
      if (isSelecting) {
        isSelecting = false;
        if (box) {
          box.remove();
          box = null;
          justDragged = true;
          setTimeout(() => { justDragged = false; }, 50);
        }
      }
    });
  }

  // --- CHUNKED FILE UPLOADER SYSTEM ---
  const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
  const uploadInput = document.getElementById('upload-input');
  const uploadProgressModal = document.getElementById('upload-progress-modal');
  const uploadProgressText = document.getElementById('upload-progress-text');
  const uploadProgressBar = document.getElementById('upload-progress-bar');
  const uploadProgressDetails = document.getElementById('upload-progress-details');

  if (uploadInput) {
    uploadInput.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);
      if (files.length === 0) return;

      showProgressModal();
      
      try {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          uploadProgressText.textContent = `Uploading ${file.name}...`;
          await uploadFileInChunks(file);
        }
        await window.playNotificationSound();
      } catch (err) {
        console.error(err);
      }

      // Refresh page after upload completes
      window.location.reload();
    });
  }

  // Drag and Drop uploads
  const dragOverlay = document.getElementById('drag-overlay');
  if (dragOverlay) {
    window.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragOverlay.classList.add('active');
    });

    dragOverlay.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    dragOverlay.addEventListener('dragleave', (e) => {
      if (e.relatedTarget === null) {
        dragOverlay.classList.remove('active');
      }
    });

    // Helper to read directory entries recursively
    function readAllEntries(dirReader) {
      return new Promise((resolve, reject) => {
        const allEntries = [];
        function read() {
          dirReader.readEntries((entries) => {
            if (entries.length === 0) {
              resolve(allEntries);
            } else {
              allEntries.push(...entries);
              read();
            }
          }, reject);
        }
        read();
      });
    }

    // Recursive depth-first traversal of FileSystemEntry
    async function traverseEntry(entry, path = '', results = []) {
      if (entry.isFile) {
        const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
        results.push({
          type: 'file',
          file: file,
          path: path
        });
      } else if (entry.isDirectory) {
        const currentPath = path ? `${path}/${entry.name}` : entry.name;
        results.push({
          type: 'directory',
          name: entry.name,
          path: currentPath
        });
        
        const dirReader = entry.createReader();
        const entries = await readAllEntries(dirReader);
        for (const childEntry of entries) {
          await traverseEntry(childEntry, currentPath, results);
        }
      }
    }

    // Helper to resolve parent path of a relative path
    function getParentPath(path) {
      const idx = path.lastIndexOf('/');
      if (idx === -1) return '';
      return path.substring(0, idx);
    }

    // Helper to create a folder on the server
    async function createFolderOnServer(name, parentId) {
      const res = await fetch('/api/folders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken
        },
        body: JSON.stringify({ name, parentId })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create directory');
      }
      const data = await res.json();
      return data.folder.id;
    }

    dragOverlay.addEventListener('drop', async (e) => {
      e.preventDefault();
      dragOverlay.classList.remove('active');

      const items = Array.from(e.dataTransfer.items || []);
      if (items.length === 0) {
        const files = Array.from(e.dataTransfer.files || []);
        if (files.length === 0) return;

        showProgressModal();

        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          uploadProgressText.textContent = `Uploading ${file.name}...`;
          await uploadFileInChunks(file);
        }

        window.location.reload();
        return;
      }

      showProgressModal();
      uploadProgressText.textContent = 'Scanning dropped items...';

      const queue = [];
      try {
        for (const item of items) {
          if (item.kind === 'file') {
            const entry = item.webkitGetAsEntry();
            if (entry) {
              await traverseEntry(entry, '', queue);
            }
          }
        }
      } catch (err) {
        console.error(err);
        alert(`Failed to scan files: ${err.message}`);
        if (uploadProgressModal) uploadProgressModal.classList.add('hidden');
        return;
      }

      if (queue.length === 0) {
        if (uploadProgressModal) uploadProgressModal.classList.add('hidden');
        return;
      }

      const pathFolderIdMap = {
        '': window.getCurrentFolderId ? window.getCurrentFolderId() : ''
      };

      try {
        for (let i = 0; i < queue.length; i++) {
          const item = queue[i];
          if (item.type === 'directory') {
            const parentPath = getParentPath(item.path);
            const parentFolderId = pathFolderIdMap[parentPath];
            
            uploadProgressText.textContent = `Creating folder ${item.name}...`;
            updateProgress(Math.round((i / queue.length) * 100), `Creating folder ${item.name}`);
            
            const folderId = await createFolderOnServer(item.name, parentFolderId);
            pathFolderIdMap[item.path] = folderId;
          } else if (item.type === 'file') {
            const parentPath = item.path;
            const parentFolderId = pathFolderIdMap[parentPath];
            
            uploadProgressText.textContent = `Uploading ${item.file.name}...`;
            await uploadFileInChunks(item.file, parentFolderId, (percent) => {
              const baseProgress = Math.round((i / queue.length) * 100);
              const stepProgress = Math.round((percent / 100) * (1 / queue.length) * 100);
              updateProgress(baseProgress + stepProgress, `Uploading ${item.file.name}`);
            });
          }
        }
      } catch (err) {
        console.error(err);
        alert(`Drop upload failed: ${err.message}`);
      }

      window.location.reload();
    });
  }

  function showProgressModal() {
    if (uploadProgressModal) uploadProgressModal.classList.remove('hidden');
    updateProgress(0, 'Preparing file slices...');
  }

  function updateProgress(percent, detailText) {
    if (uploadProgressBar) uploadProgressBar.style.width = `${percent}%`;
    if (uploadProgressDetails) uploadProgressDetails.textContent = `${percent}% - ${detailText}`;
  }

  async function uploadFileInChunks(file, folderId, onProgress) {
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    // Unique ID based on name, size and date
    const uploadId = md5(`${file.name}-${file.size}-${file.lastModified}`);
    const resolvedFolderId = folderId !== undefined ? folderId : (window.getCurrentFolderId ? window.getCurrentFolderId() : '');

    try {
      // 1. Query server to see which chunks were already successfully uploaded
      const statusRes = await fetch(`/api/upload/status?uploadId=${uploadId}`);
      const statusData = await statusRes.json();
      const uploadedChunks = new Set(statusData.uploadedChunks || []);

      // 2. Upload missing chunks sequentially
      for (let i = 0; i < totalChunks; i++) {
        if (uploadedChunks.has(i)) {
          const percent = Math.round(((i + 1) / totalChunks) * 100);
          if (onProgress) onProgress(percent);
          else updateProgress(percent, `Resuming chunk ${i + 1} of ${totalChunks}`);
          continue;
        }

        const start = i * CHUNK_SIZE;
        const end = Math.min(file.size, start + CHUNK_SIZE);
        const chunkBlob = file.slice(start, end);
        
        const formData = new FormData();
        formData.append('uploadId', uploadId);
        formData.append('chunkIndex', i);
        formData.append('chunk', chunkBlob, `chunk_${i}`);

        await uploadChunkWithRetry(formData);
        
        const percent = Math.round(((i + 1) / totalChunks) * 100);
        if (onProgress) onProgress(percent);
        else updateProgress(percent, `Uploaded chunk ${i + 1} of ${totalChunks}`);
      }

      // 3. Request final merge
      if (onProgress) onProgress(99);
      else updateProgress(99, 'Assembling slices on disk...');
      
      const completeRes = await fetch('/api/upload/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken
        },
        body: JSON.stringify({
          uploadId,
          totalChunks,
          filename: file.name,
          folderId: resolvedFolderId
        })
      });

      if (!completeRes.ok) {
        const errData = await completeRes.json().catch(() => ({}));
        throw new Error(errData.error || 'Merge request failed on the server');
      }

    } catch (err) {
      console.error(err);
      alert(`Upload failed for ${file.name}: ${err.message}`);
    }
  }

  async function uploadChunkWithRetry(formData, attempt = 1) {
    try {
      const res = await fetch('/api/upload/chunk', {
        method: 'POST',
        headers: {
          'x-csrf-token': csrfToken
        },
        body: formData
      });

      if (!res.ok) throw new Error(`Status ${res.status}`);
    } catch (err) {
      if (attempt < 3) {
        console.warn(`Chunk upload retry attempt ${attempt}...`);
        await new Promise(r => setTimeout(r, 1000 * attempt));
        return uploadChunkWithRetry(formData, attempt + 1);
      }
      throw err;
    }
  }

  // Simple MD5/Hash helper for uniqueness
  function md5(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16);
  }

  // Expose triggers globally
  window.clearSelection = clearSelection;
  window.selectedItems = () => selectedItems;
  window.formatBytes = formatBytes;
});
