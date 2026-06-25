// Main Drive client interactions and chunked uploader
window.getCurrentFolderId = function() {
  if (window.driveContext && window.driveContext.currentFolderId) {
    return window.driveContext.currentFolderId;
  }

  const folderMatch = window.location.pathname.match(/^\/folders\/(\d+)\/?$/);
  if (folderMatch) return folderMatch[1];

  return '';
};

document.addEventListener('DOMContentLoaded', () => {
  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
  
  // --- CLICK-BASED DROPDOWNS & SIDEBAR ACTIONS ---
  const newDropdownBtn = document.getElementById('new-dropdown-btn');
  const newDropdownMenu = document.getElementById('new-dropdown-menu');
  const profileDropdownBtn = document.getElementById('profile-dropdown-btn');
  const profileDropdownMenu = document.getElementById('profile-dropdown-menu');

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

  // Close button for the details aside panel
  const closeDetailsBtn = document.getElementById('close-details-btn');
  if (closeDetailsBtn) {
    closeDetailsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      clearSelection();
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

  // Handle single clicks on item cards
  items.forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
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
  });

  // Clear selections and close dropdowns on clicking white spaces
  document.addEventListener('click', () => {
    clearSelection();
    if (newDropdownMenu) newDropdownMenu.classList.add('hidden');
    if (profileDropdownMenu) profileDropdownMenu.classList.add('hidden');
  });

  // --- DETAILS PANE RENDERER ---
  function updateDetailsPane() {
    if (selectedItems.length === 0) {
      // Hide the entire aside panel
      if (detailsAside) detailsAside.classList.add('details-aside--hidden');
      return;
    }
    
    // Show the aside panel (slide in)
    if (detailsAside) detailsAside.classList.remove('details-aside--hidden');

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
    let startX = 0, startY = 0, isSelecting = false;
    let box = null;

    gridContainer.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.target.closest('.grid-item') || e.target.closest('button') || e.target.closest('input')) return;
      
      startX = e.pageX;
      startY = e.pageY;
      isSelecting = true;
      clearSelection();

      box = document.createElement('div');
      box.className = 'selection-box';
      document.body.appendChild(box);
    });

    document.addEventListener('mousemove', (e) => {
      if (!isSelecting || !box) return;

      const currentX = e.pageX;
      const currentY = e.pageY;

      const x = Math.min(startX, currentX);
      const y = Math.min(startY, currentY);
      const w = Math.abs(startX - currentX);
      const h = Math.abs(startY - currentY);

      box.style.left = x + 'px';
      box.style.top = y + 'px';
      box.style.width = w + 'px';
      box.style.height = h + 'px';

      // Check collisions with grid items
      const boxRect = box.getBoundingClientRect();
      items.forEach(item => {
        const itemRect = item.getBoundingClientRect();
        const intersect = !(itemRect.right < boxRect.left || 
                            itemRect.left > boxRect.right || 
                            itemRect.bottom < boxRect.top || 
                            itemRect.top > boxRect.bottom);
        if (intersect) {
          selectItem(item, true);
        } else {
          deselectItem(item);
        }
      });
    });

    document.addEventListener('mouseup', () => {
      if (isSelecting) {
        isSelecting = false;
        if (box) {
          box.remove();
          box = null;
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
      
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        uploadProgressText.textContent = `Uploading ${file.name}...`;
        await uploadFileInChunks(file);
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

    dragOverlay.addEventListener('drop', async (e) => {
      e.preventDefault();
      dragOverlay.classList.remove('active');

      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;

      showProgressModal();

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        uploadProgressText.textContent = `Uploading ${file.name}...`;
        await uploadFileInChunks(file);
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

  async function uploadFileInChunks(file) {
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    // Unique ID based on name, size and date
    const uploadId = md5(`${file.name}-${file.size}-${file.lastModified}`);
    const folderId = window.getCurrentFolderId ? window.getCurrentFolderId() : '';

    try {
      // 1. Query server to see which chunks were already successfully uploaded
      const statusRes = await fetch(`/api/upload/status?uploadId=${uploadId}`);
      const statusData = await statusRes.json();
      const uploadedChunks = new Set(statusData.uploadedChunks || []);

      // 2. Upload missing chunks sequentially
      for (let i = 0; i < totalChunks; i++) {
        if (uploadedChunks.has(i)) {
          const percent = Math.round(((i + 1) / totalChunks) * 100);
          updateProgress(percent, `Resuming chunk ${i + 1} of ${totalChunks}`);
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
        updateProgress(percent, `Uploaded chunk ${i + 1} of ${totalChunks}`);
      }

      // 3. Request final merge
      updateProgress(99, 'Assembling slices on disk...');
      
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
          folderId
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
