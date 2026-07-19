// Main Drive client interactions and chunked uploader
window.getCurrentFolderId = function() {
  if (window.driveContext && window.driveContext.currentFolderId) {
    return window.driveContext.currentFolderId;
  }

  const folderMatch = window.location.pathname.match(/^\/folders\/(\d+)\/?$/);
  if (folderMatch) return folderMatch[1];

  return '';
};

let notificationAudio = null;

window.primeNotificationSound = function() {
  if (!notificationAudio) {
    notificationAudio = new Audio('/sounds/Notification%20Sound.mp3');
    notificationAudio.preload = 'auto';
  }

  const previousVolume = notificationAudio.volume;
  notificationAudio.volume = 0;
  notificationAudio.play()
    .then(() => {
      notificationAudio.pause();
      notificationAudio.currentTime = 0;
      notificationAudio.volume = previousVolume;
    })
    .catch(() => {
      notificationAudio.volume = previousVolume;
    });
};

window.playNotificationSound = function() {
  return new Promise((resolve) => {
    const audio = notificationAudio || new Audio('/sounds/Notification%20Sound.mp3');
    notificationAudio = audio;
    audio.volume = 1;
    audio.currentTime = 0;
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
  const currentFolderCanEdit = window.driveContext?.currentFolderCanEdit === true || window.driveContext?.currentFolderCanEdit === 'true';
  
  // --- CLICK-BASED DROPDOWNS & SIDEBAR ACTIONS ---
  const newDropdownBtn = document.getElementById('new-dropdown-btn');
  const newDropdownMenu = document.getElementById('new-dropdown-menu');
  const sidebarUploadBtn = document.getElementById('sidebar-upload-btn');
  const sidebarNewFolderBtn = document.getElementById('new-folder-modal-btn');
  const sidebarFolderUploadBtn = document.getElementById('sidebar-folder-upload-btn');
  const profileDropdownBtn = document.getElementById('profile-dropdown-btn');
  const profileDropdownMenu = document.getElementById('profile-dropdown-menu');
  const mobileSidebarToggle = document.getElementById('mobile-sidebar-toggle');
  const mobileSidebarClose = document.getElementById('mobile-sidebar-close');
  const driveSidebar = document.getElementById('drive-sidebar');
  const driveSidebarBackdrop = document.getElementById('drive-sidebar-backdrop');
  const itemsGridContainer = document.getElementById('items-grid-container');
  const layoutListBtn = document.getElementById('layout-list-btn');
  const layoutGridBtn = document.getElementById('layout-grid-btn');
  const DRIVE_LAYOUT_KEY = 'harbor-drive-layout';

  function applyDriveLayout(layout) {
    if (!itemsGridContainer) return;

    const resolvedLayout = layout === 'list' ? 'list' : 'grid';
    itemsGridContainer.classList.toggle('drive-layout-list', resolvedLayout === 'list');
    itemsGridContainer.classList.toggle('drive-layout-grid', resolvedLayout === 'grid');
    layoutListBtn?.setAttribute('aria-pressed', String(resolvedLayout === 'list'));
    layoutGridBtn?.setAttribute('aria-pressed', String(resolvedLayout === 'grid'));

    try {
      localStorage.setItem(DRIVE_LAYOUT_KEY, resolvedLayout);
    } catch {
      // Storage may be unavailable in restricted/private browser contexts.
    }
  }

  let savedDriveLayout = 'grid';
  try {
    savedDriveLayout = localStorage.getItem(DRIVE_LAYOUT_KEY) || 'grid';
  } catch {
    savedDriveLayout = 'grid';
  }
  applyDriveLayout(savedDriveLayout);

  layoutListBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    applyDriveLayout('list');
  });

  layoutGridBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    applyDriveLayout('grid');
  });

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

  function canWriteCurrentFolder() {
    if (currentFolderCanEdit) return true;
    alert('You only have viewer access here. Ask the owner for editor access to upload or create folders.');
    return false;
  }

  [newDropdownBtn, sidebarNewFolderBtn, sidebarUploadBtn, sidebarFolderUploadBtn].forEach(control => {
    if (!control || currentFolderCanEdit) return;
    control.classList.add('opacity-50', 'cursor-not-allowed');
    control.title = 'Editor access is required to upload or create folders here';
  });

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
      if (!canWriteCurrentFolder()) return;
      newDropdownMenu.classList.toggle('hidden');
      if (profileDropdownMenu) profileDropdownMenu.classList.add('hidden');
      document.querySelector('#search-type-dropdown .dropdown-menu')?.classList.add('hidden');
      document.querySelector('#search-sortBy-dropdown .dropdown-menu')?.classList.add('hidden');
    });
  }

  if (profileDropdownBtn && profileDropdownMenu) {
    profileDropdownBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      profileDropdownMenu.classList.toggle('hidden');
      if (newDropdownMenu) newDropdownMenu.classList.add('hidden');
      document.querySelector('#search-type-dropdown .dropdown-menu')?.classList.add('hidden');
      document.querySelector('#search-sortBy-dropdown .dropdown-menu')?.classList.add('hidden');
    });
  }

  // --- CUSTOM SEARCH DROPDOWNS ---
  const searchTypeDropdown = document.getElementById('search-type-dropdown');
  const searchSortDropdown = document.getElementById('search-sortBy-dropdown');

  if (searchTypeDropdown) {
    const trigger = searchTypeDropdown.querySelector('.dropdown-trigger');
    const menu = searchTypeDropdown.querySelector('.dropdown-menu');
    const input = document.getElementById('search-type-input');
    const form = searchTypeDropdown.closest('form');

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('hidden');
      if (searchSortDropdown) {
        searchSortDropdown.querySelector('.dropdown-menu').classList.add('hidden');
      }
      if (newDropdownMenu) newDropdownMenu.classList.add('hidden');
      if (profileDropdownMenu) profileDropdownMenu.classList.add('hidden');
    });

    searchTypeDropdown.querySelectorAll('.dropdown-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const value = item.getAttribute('data-value');
        if (input && form) {
          input.value = value;
          form.submit();
        }
        menu.classList.add('hidden');
      });
    });
  }

  if (searchSortDropdown) {
    const trigger = searchSortDropdown.querySelector('.dropdown-trigger');
    const menu = searchSortDropdown.querySelector('.dropdown-menu');
    const input = document.getElementById('search-sortBy-input');
    const form = searchSortDropdown.closest('form');

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('hidden');
      if (searchTypeDropdown) {
        searchTypeDropdown.querySelector('.dropdown-menu').classList.add('hidden');
      }
      if (newDropdownMenu) newDropdownMenu.classList.add('hidden');
      if (profileDropdownMenu) profileDropdownMenu.classList.add('hidden');
    });

    searchSortDropdown.querySelectorAll('.dropdown-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const value = item.getAttribute('data-value');
        if (input && form) {
          input.value = value;
          form.submit();
        }
        menu.classList.add('hidden');
      });
    });
  }

  // Close dropdowns when clicking outside (using capture phase to bypass stopPropagation)
  document.addEventListener('click', (e) => {
    if (searchTypeDropdown && !searchTypeDropdown.contains(e.target)) {
      searchTypeDropdown.querySelector('.dropdown-menu')?.classList.add('hidden');
    }
    if (searchSortDropdown && !searchSortDropdown.contains(e.target)) {
      searchSortDropdown.querySelector('.dropdown-menu')?.classList.add('hidden');
    }
    if (newDropdownMenu && newDropdownBtn && !newDropdownBtn.contains(e.target) && !newDropdownMenu.contains(e.target)) {
      newDropdownMenu.classList.add('hidden');
    }
    if (profileDropdownMenu && profileDropdownBtn && !profileDropdownBtn.contains(e.target) && !profileDropdownMenu.contains(e.target)) {
      profileDropdownMenu.classList.add('hidden');
    }
  }, true);

  // Sidebar upload button
  if (sidebarUploadBtn) {
    sidebarUploadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!canWriteCurrentFolder()) return;
      if (newDropdownMenu) newDropdownMenu.classList.add('hidden');
      const uploadInput = document.getElementById('upload-input');
      if (uploadInput) uploadInput.click();
    });
  }

  // Sidebar new folder button
  if (sidebarNewFolderBtn) {
    sidebarNewFolderBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!canWriteCurrentFolder()) return;
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
  let internalItemDrag = false;
  const DRIVE_ITEMS_MIME = 'application/x-harbor-drive-items';
  const DRIVE_TOAST_STORAGE_KEY = 'harbor-drive-toast';

  function showDriveToast(message, type = 'info', duration = 5200) {
    if (!message) return;
    const toastDuration = Number.isFinite(duration) ? Math.max(duration, 1800) : 5200;

    let container = document.getElementById('drive-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'drive-toast-container';
      container.className = 'fixed bottom-4 right-4 left-4 md:left-auto z-[10000] flex flex-col gap-2 pointer-events-none';
      container.style.maxWidth = '26rem';
      document.body.appendChild(container);
    }

    const tones = {
      success: {
        icon: 'bi-check-circle-fill',
        iconClass: 'text-brand-teal bg-teal-50 border-brand-teal/20',
        progressClass: 'bg-brand-teal'
      },
      error: {
        icon: 'bi-exclamation-circle-fill',
        iconClass: 'text-red-600 bg-red-50 border-red-200',
        progressClass: 'bg-red-500'
      },
      warning: {
        icon: 'bi-exclamation-triangle-fill',
        iconClass: 'text-amber-700 bg-amber-50 border-amber-200',
        progressClass: 'bg-amber-500'
      },
      info: {
        icon: 'bi-info-circle-fill',
        iconClass: 'text-brand-teal bg-teal-50 border-brand-teal/20',
        progressClass: 'bg-brand-teal'
      }
    };
    const tone = tones[type] || tones.info;

    const toast = document.createElement('div');
    toast.className = 'pointer-events-auto bg-white border border-gray-200 shadow-xl rounded-xl overflow-hidden select-none transition duration-200 translate-y-2 opacity-0';
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

    const content = document.createElement('div');
    content.className = 'flex items-center gap-3 px-4 py-3';

    const iconWrap = document.createElement('div');
    iconWrap.className = `w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${tone.iconClass}`;
    iconWrap.innerHTML = `<i class="bi ${tone.icon} text-base"></i>`;

    const text = document.createElement('div');
    text.className = 'min-w-0 flex-1 text-sm font-semibold text-gray-800 leading-tight';
    text.textContent = message;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'p-1.5 -mr-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-md transition';
    closeBtn.setAttribute('aria-label', 'Dismiss notification');
    closeBtn.innerHTML = '<i class="bi bi-x-lg text-xs"></i>';

    const progressTrack = document.createElement('div');
    progressTrack.className = 'h-1 bg-gray-100 overflow-hidden';

    const progressBar = document.createElement('div');
    progressBar.className = `${tone.progressClass} h-1`;
    progressBar.style.width = '100%';
    progressBar.style.transition = `width ${toastDuration}ms linear`;
    progressTrack.appendChild(progressBar);

    content.append(iconWrap, text, closeBtn);
    toast.append(content, progressTrack);
    container.appendChild(toast);

    let removeTimeoutId = null;
    const dismiss = () => {
      window.clearTimeout(removeTimeoutId);
      toast.classList.add('translate-y-2', 'opacity-0');
      setTimeout(() => toast.remove(), 220);
    };

    closeBtn.addEventListener('click', dismiss);

    requestAnimationFrame(() => {
      toast.classList.remove('translate-y-2', 'opacity-0');
      requestAnimationFrame(() => {
        progressBar.style.width = '0%';
      });
    });

    removeTimeoutId = setTimeout(dismiss, toastDuration);
  }

  function queueDriveToast(message, type = 'info', duration = 5200) {
    sessionStorage.setItem(DRIVE_TOAST_STORAGE_KEY, JSON.stringify({ message, type, duration }));
  }

  function showQueuedDriveToast() {
    const rawToast = sessionStorage.getItem(DRIVE_TOAST_STORAGE_KEY);
    if (!rawToast) return;

    sessionStorage.removeItem(DRIVE_TOAST_STORAGE_KEY);
    try {
      const toast = JSON.parse(rawToast);
      showDriveToast(toast.message, toast.type, toast.duration);
    } catch {
      showDriveToast(rawToast);
    }
  }

  window.showDriveToast = showDriveToast;
  window.queueDriveToast = queueDriveToast;
  showQueuedDriveToast();

  const instantTooltip = document.createElement('div');
  instantTooltip.id = 'instant-action-tooltip';
  instantTooltip.className = 'fixed z-[10001] hidden pointer-events-none bg-gray-900 text-white text-[11px] font-semibold px-2 py-1 rounded-md shadow-lg whitespace-nowrap opacity-0 transition-opacity duration-75';
  document.body.appendChild(instantTooltip);

  function positionInstantTooltip(target) {
    const label = target.dataset.tooltip;
    if (!label) return;

    instantTooltip.textContent = label;
    instantTooltip.classList.remove('hidden');
    instantTooltip.style.left = '0px';
    instantTooltip.style.top = '0px';

    const targetRect = target.getBoundingClientRect();
    const tooltipRect = instantTooltip.getBoundingClientRect();
    const padding = 8;
    const left = Math.min(
      Math.max(targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2), padding),
      window.innerWidth - tooltipRect.width - padding
    );
    const preferredTop = targetRect.bottom + padding;
    const top = preferredTop + tooltipRect.height <= window.innerHeight - padding
      ? preferredTop
      : Math.max(targetRect.top - tooltipRect.height - padding, padding);

    instantTooltip.style.left = `${left}px`;
    instantTooltip.style.top = `${top}px`;
    instantTooltip.classList.remove('opacity-0');
  }

  function hideInstantTooltip() {
    instantTooltip.classList.add('opacity-0');
    instantTooltip.classList.add('hidden');
  }

  document.querySelectorAll('.drive-action-bar [data-tooltip]').forEach(button => {
    button.addEventListener('mouseenter', () => positionInstantTooltip(button));
    button.addEventListener('focus', () => positionInstantTooltip(button));
    button.addEventListener('mouseleave', hideInstantTooltip);
    button.addEventListener('blur', hideInstantTooltip);
    button.addEventListener('click', hideInstantTooltip);
  });

  // Custom Context Menu Overlay
  const contextMenu = document.createElement('div');
  contextMenu.id = 'custom-context-menu';
  contextMenu.className = 'fixed bg-white border border-gray-200 rounded-xl shadow-xl py-1 w-48 z-[9999] hidden select-none text-gray-700 text-xs font-semibold transition-all duration-100';
  contextMenu.innerHTML = `
    <button id="context-open" class="w-full text-left px-3 py-1.5 hover:bg-gray-100 flex items-center gap-2 transition duration-150">
      <i class="bi bi-folder2-open text-gray-500 text-sm"></i>
      <span>Open</span>
    </button>
    <div class="h-px bg-gray-200 my-1"></div>
    <button id="context-download" class="w-full text-left px-3 py-1.5 hover:bg-gray-100 flex items-center gap-2 transition duration-150">
      <i class="bi bi-download text-gray-500 text-sm"></i>
      <span>Download</span>
    </button>
    <button id="context-rename" class="w-full text-left px-3 py-1.5 hover:bg-gray-100 flex items-center gap-2 transition duration-150">
      <i class="bi bi-pencil text-gray-500 text-sm"></i>
      <span>Rename</span>
    </button>
    <button id="context-copy-clipboard" class="w-full text-left px-3 py-1.5 hover:bg-gray-100 flex items-center gap-2 transition duration-150">
      <i class="bi bi-copy text-gray-500 text-sm"></i>
      <span>Copy</span>
    </button>
    <button id="context-cut-clipboard" class="w-full text-left px-3 py-1.5 hover:bg-gray-100 flex items-center gap-2 transition duration-150">
      <i class="bi bi-scissors text-gray-500 text-sm"></i>
      <span>Cut</span>
    </button>
    <button id="context-copy" class="w-full text-left px-3 py-1.5 hover:bg-gray-100 flex items-center gap-2 transition duration-150">
      <i class="bi bi-file-earmark-medical text-gray-500 text-sm"></i>
      <span>Copy to...</span>
    </button>
    <div class="h-px bg-gray-200 my-1"></div>
    <button id="context-share" class="w-full text-left px-3 py-1.5 hover:bg-gray-100 flex items-center gap-2 transition duration-150">
      <i class="bi bi-share text-gray-500 text-sm"></i>
      <span>Share</span>
    </button>
    <button id="context-move" class="w-full text-left px-3 py-1.5 hover:bg-gray-100 flex items-center gap-2 transition duration-150">
      <i class="bi bi-folder-symlink text-gray-500 text-sm"></i>
      <span>Move to</span>
    </button>
    <button id="context-properties" class="w-full text-left px-3 py-1.5 hover:bg-gray-100 flex items-center gap-2 transition duration-150">
      <i class="bi bi-info-circle text-gray-500 text-sm"></i>
      <span>Properties</span>
    </button>
    <div class="h-px bg-gray-200 my-1"></div>
    <button id="context-delete" class="w-full text-left px-3 py-1.5 hover:bg-gray-100 text-red-600 flex items-center gap-2 transition duration-150">
      <i class="bi bi-trash text-red-500 text-sm"></i>
      <span>${isTrashTab ? 'Delete permanently' : 'Move to bin'}</span>
    </button>
  `;
  document.body.appendChild(contextMenu);

  // Custom Context Menu for Empty Space of the Drive
  const emptySpaceContextMenu = document.createElement('div');
  emptySpaceContextMenu.id = 'empty-space-context-menu';
  emptySpaceContextMenu.className = 'fixed bg-white border border-gray-200 rounded-xl shadow-xl py-1 w-48 z-[9999] hidden select-none text-gray-700 text-xs font-semibold transition-all duration-100';
  emptySpaceContextMenu.innerHTML = `
    <button id="empty-context-new-folder" class="w-full text-left px-3 py-1.5 hover:bg-gray-100 flex items-center gap-2 transition duration-150">
      <i class="bi bi-folder-plus text-brand-teal text-sm"></i>
      <span>New folder</span>
    </button>
    <div class="h-px bg-gray-200 my-1"></div>
    <button id="empty-context-upload-file" class="w-full text-left px-3 py-1.5 hover:bg-gray-100 flex items-center gap-2 transition duration-150">
      <i class="bi bi-file-earmark-arrow-up text-brand-teal text-sm"></i>
      <span>File upload</span>
    </button>
    <button id="empty-context-upload-folder" class="w-full text-left px-3 py-1.5 hover:bg-gray-100 flex items-center gap-2 transition duration-150">
      <i class="bi bi-folder-symlink text-brand-teal text-sm"></i>
      <span>Folder upload</span>
    </button>
    <div class="h-px bg-gray-200 my-1"></div>
    <button id="empty-context-paste" class="w-full text-left px-3 py-1.5 hover:bg-gray-100 flex items-center gap-2 transition duration-150">
      <i class="bi bi-clipboard-check text-gray-500 text-sm"></i>
      <span>Paste</span>
    </button>
  `;
  document.body.appendChild(emptySpaceContextMenu);

  function positionContextMenu(menu, clientX, clientY) {
    const viewportPadding = 10;
    const maxHeight = Math.max(window.innerHeight - (viewportPadding * 2), 120);

    menu.style.maxHeight = `${maxHeight}px`;
    menu.style.overflowY = 'auto';
    menu.style.left = '0px';
    menu.style.top = '0px';
    menu.style.visibility = 'hidden';
    menu.classList.remove('hidden');

    const rect = menu.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width - viewportPadding;
    const maxTop = window.innerHeight - rect.height - viewportPadding;
    const left = Math.min(Math.max(clientX, viewportPadding), Math.max(maxLeft, viewportPadding));
    const top = Math.min(Math.max(clientY, viewportPadding), Math.max(maxTop, viewportPadding));

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.visibility = '';
  }

  const toolbarDeleteBtn = document.getElementById('detail-delete-btn');
  if (toolbarDeleteBtn && isTrashTab) {
    toolbarDeleteBtn.dataset.tooltip = 'Delete permanently';
    toolbarDeleteBtn.setAttribute('aria-label', 'Delete permanently');
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

  function selectAllItems() {
    selectedItems = Array.from(items);
    selectedItems.forEach(item => item.classList.add('selected'));
    updateDetailsPane();
  }

  function setSelectedItems(elements) {
    items.forEach(item => item.classList.remove('selected'));
    selectedItems = Array.from(elements || []).filter(Boolean);
    selectedItems.forEach(item => item.classList.add('selected'));
    updateDetailsPane();
  }

  function getClipboardItemsFromSelection() {
    return selectedItems.map(el => ({
      id: el.dataset.id,
      type: el.dataset.type,
      name: el.dataset.name || el.dataset.type
    }));
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

  // Helper to open a folder or preview a file
  function openItem(item) {
    const type = item.dataset.type;
    const id = item.dataset.id;
    if (type === 'folder') {
      if (!window.driveContext || window.driveContext.tab === 'my-drive' || window.driveContext.tab === 'shared') {
        window.location.href = `/folders/${id}`;
      }
    } else {
      // Preview file
      const mime = item.dataset.mime || '';
      const ext = (item.dataset.ext || '').toLowerCase();
      let route = 'code';
      if (mime.startsWith('image/')) route = 'image';
      else if (mime === 'application/pdf' || ext === 'pdf') route = 'pdf';
      else if (mime.startsWith('video/')) route = 'video';
      else if (mime.startsWith('audio/')) route = 'audio';
      else if (ext === 'md') route = 'markdown';
      else if (['ai', 'eps', 'psd', 'psb', 'indd', 'xd', 'sketch'].includes(ext)) route = 'design';
      else if (['doc', 'docx'].includes(ext) || mime === 'application/msword' || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') route = 'word';
      else if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) route = 'excel';
      else if (['ppt', 'pptx'].includes(ext) || mime === 'application/vnd.ms-powerpoint' || mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') route = 'presentation';
      else if (ext === 'zip' || mime === 'application/zip' || mime === 'application/x-zip-compressed') route = 'zip';
      else if (!['js', 'ts', 'html', 'css', 'json', 'xml', 'sql', 'php', 'py', 'go', 'rs', 'cpp', 'c', 'cs', 'java', 'sh', 'bat', 'yaml', 'yml', 'ini', 'conf'].includes(ext) && !mime.startsWith('text/')) route = 'unsupported';
      
      window.open(`/preview/${route}/${id}`, '_blank');
    }
  }

  // Handle single clicks on item cards
  items.forEach(item => {
    item.draggable = !isTrashTab;
    item.querySelectorAll('img').forEach(image => {
      image.draggable = false;
    });

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
      openItem(item);
    });

    // Right click for context menu
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (!selectedItems.includes(item)) {
        selectItem(item, false);
      }

      positionContextMenu(contextMenu, e.clientX, e.clientY);
    });

    if (!isTrashTab) {
      item.addEventListener('dragstart', (e) => {
        if (!selectedItems.includes(item)) {
          selectItem(item, false);
        }

        const payload = selectedItems.map(selected => ({
          id: selected.dataset.id,
          type: selected.dataset.type,
          name: selected.dataset.name || selected.dataset.type
        }));

        internalItemDrag = true;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData(DRIVE_ITEMS_MIME, JSON.stringify(payload));
        e.dataTransfer.setData('text/plain', payload.map(entry => entry.name).join(', '));
        selectedItems.forEach(selected => selected.classList.add('is-dragging'));
      });

      item.addEventListener('dragend', () => {
        internalItemDrag = false;
        items.forEach(candidate => {
          candidate.classList.remove('is-dragging', 'is-drop-target', 'is-moving');
        });
      });
    }
  });

  function readDraggedDriveItems(dataTransfer) {
    if (!dataTransfer) return [];

    try {
      const rawPayload = dataTransfer.getData(DRIVE_ITEMS_MIME);
      const payload = JSON.parse(rawPayload || '[]');
      return Array.isArray(payload) ? payload : [];
    } catch {
      return [];
    }
  }

  async function moveDriveItemsToFolder(draggedItems, destinationFolder) {
    const destinationFolderId = destinationFolder.dataset.id || null;
    if (draggedItems.some(entry => entry.type === 'folder' && entry.id === destinationFolderId)) {
      throw new Error('A folder cannot be moved into itself.');
    }

    destinationFolder.classList.add('is-moving');

    try {
      await Promise.all(draggedItems.map(async entry => {
        const payload = {
          destinationFolderId
        };

        if (entry.type === 'folder') payload.folderId = entry.id;
        else payload.fileId = entry.id;

        const res = await fetch(`/api/${entry.type}s/move`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': csrfToken
          },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Failed to move ${entry.name}`);
        }
      }));
    } finally {
      destinationFolder.classList.remove('is-moving');
    }
  }

  if (!isTrashTab) {
    const dropTargets = document.querySelectorAll('.grid-item[data-type="folder"], .sidebar-folder-drop-target');
    dropTargets.forEach(folder => {
      folder.addEventListener('dragenter', (e) => {
        if (!internalItemDrag) return;
        e.preventDefault();
        e.stopPropagation();
        folder.classList.add('is-drop-target');
      });

      folder.addEventListener('dragover', (e) => {
        if (!internalItemDrag) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        folder.classList.add('is-drop-target');
      });

      folder.addEventListener('dragleave', (e) => {
        if (!folder.contains(e.relatedTarget)) {
          folder.classList.remove('is-drop-target');
        }
      });

      folder.addEventListener('drop', async (e) => {
        if (!internalItemDrag) return;
        e.preventDefault();
        e.stopPropagation();
        folder.classList.remove('is-drop-target');

        const draggedItems = readDraggedDriveItems(e.dataTransfer);
        if (draggedItems.length === 0) return;

        try {
          await moveDriveItemsToFolder(draggedItems, folder);
          queueDriveToast(`${draggedItems.length} item(s) moved`, 'success');
          window.location.reload();
        } catch (err) {
          showDriveToast(err.message || 'Unable to move the selected items.', 'error');
        }
      });
    });
  }

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

  document.getElementById('context-copy-clipboard').addEventListener('click', (e) => {
    e.stopPropagation();
    window.driveClipboard?.copySelection();
    contextMenu.classList.add('hidden');
  });

  document.getElementById('context-cut-clipboard').addEventListener('click', (e) => {
    e.stopPropagation();
    window.driveClipboard?.cutSelection();
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

  // Event handlers for empty space context menu items
  document.getElementById('empty-context-new-folder').addEventListener('click', (e) => {
    e.stopPropagation();
    emptySpaceContextMenu.classList.add('hidden');
    if (!canWriteCurrentFolder()) return;
    const btn = document.getElementById('new-folder-modal-btn');
    if (btn) btn.click();
  });

  document.getElementById('empty-context-upload-file').addEventListener('click', (e) => {
    e.stopPropagation();
    emptySpaceContextMenu.classList.add('hidden');
    if (!canWriteCurrentFolder()) return;
    const btn = document.getElementById('sidebar-upload-btn');
    if (btn) btn.click();
  });

  document.getElementById('empty-context-upload-folder').addEventListener('click', (e) => {
    e.stopPropagation();
    emptySpaceContextMenu.classList.add('hidden');
    if (!canWriteCurrentFolder()) return;
    const btn = document.getElementById('sidebar-folder-upload-btn');
    if (btn) btn.click();
  });

  document.getElementById('empty-context-paste').addEventListener('click', (e) => {
    e.stopPropagation();
    emptySpaceContextMenu.classList.add('hidden');
    window.driveClipboard?.paste();
  });

  async function applyTrashAction(action, selected, { confirmMessage, emptyMessage, successMessage, failureMessage }) {
    if (!selected || selected.length === 0) {
      if (emptyMessage) showDriveToast(emptyMessage, 'warning', 7000);
      return false;
    }

    if (confirmMessage && !await confirm(confirmMessage)) {
      return false;
    }

    const res = await fetch('/api/trash/bulk', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken
      },
      body: JSON.stringify({
        action,
        items: selected.map(el => ({
          entityId: el.dataset.id,
          entityType: el.dataset.type
        }))
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || failureMessage || 'Trash action failed');
    }

    selected.slice(0, data.processed || selected.length).forEach(el => el.remove());
    if (data.failed > 0) {
      queueDriveToast(`${data.processed || 0} item(s) completed, ${data.failed} failed`, 'warning', 8000);
    } else if (successMessage) {
      queueDriveToast(successMessage, 'success', 7000);
    }
    window.location.reload();
    return true;
  }

  window.moveSelectedToTrash = function(selectedOverride) {
    const selected = selectedOverride || (window.selectedItems ? window.selectedItems() : []);
    return applyTrashAction('move', selected, {
      confirmMessage: `Move ${selected.length} selected item(s) to trash?`,
      emptyMessage: 'Select at least one item first.',
      successMessage: `${selected.length} item(s) moved to trash`,
      failureMessage: 'Move to trash failed'
    }).catch(err => {
      console.error(err);
      showDriveToast(err.message || 'Move to trash failed', 'error', 7000);
    });
  };

  window.restoreSelected = function(selectedOverride) {
    const selected = selectedOverride || (window.selectedItems ? window.selectedItems() : []);
    return applyTrashAction('restore', selected, {
      emptyMessage: 'Select at least one item to restore.',
      successMessage: `${selected.length} item(s) restored`,
      failureMessage: 'Restore failed'
    }).catch(err => {
      console.error(err);
      showDriveToast(err.message || 'Restore failed', 'error', 7000);
    });
  };

  window.purgeSelected = function(selectedOverride) {
    const selected = selectedOverride || (window.selectedItems ? window.selectedItems() : []);
    return applyTrashAction('purge', selected, {
      confirmMessage: 'Permanently delete selected item(s) from disk? This action CANNOT be undone.',
      emptyMessage: 'Select at least one item to delete permanently.',
      successMessage: `${selected.length} item(s) permanently deleted`,
      failureMessage: 'Permanent delete failed'
    }).catch(err => {
      console.error(err);
      showDriveToast(err.message || 'Permanent delete failed', 'error', 7000);
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
    document.querySelector('#search-type-dropdown .dropdown-menu')?.classList.add('hidden');
    document.querySelector('#search-sortBy-dropdown .dropdown-menu')?.classList.add('hidden');
    contextMenu.classList.add('hidden');
    emptySpaceContextMenu.classList.add('hidden');
  });

  document.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('.grid-item')) {
      contextMenu.classList.add('hidden');
    }
    if (!e.target.closest('#items-grid-container')) {
      emptySpaceContextMenu.classList.add('hidden');
    }
  });

  // Right-click on empty space inside items grid container
  if (itemsGridContainer) {
    itemsGridContainer.addEventListener('contextmenu', (e) => {
      // If right click is on a grid item, do nothing here (item contextmenu handler will handle it)
      if (e.target.closest('.grid-item')) {
        emptySpaceContextMenu.classList.add('hidden');
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      // Clear selection
      clearSelection();

      positionContextMenu(emptySpaceContextMenu, e.clientX, e.clientY);

      // Hide the item context menu
      contextMenu.classList.add('hidden');
    });
  }

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
      } else if (['ai', 'eps'].includes(ext)) {
        iconClass = 'bi-vector-pen';
      } else if (['psd', 'psb'].includes(ext)) {
        iconClass = 'bi-layers-fill';
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
      const deleteLabel = isTrashTab ? 'Delete permanently' : 'Move to Trash';
      deleteBtn.dataset.tooltip = deleteLabel;
      deleteBtn.setAttribute('aria-label', deleteLabel);
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
  const gridContainer = itemsGridContainer;
  if (gridContainer) {
    let startClientX = 0, startClientY = 0, isSelecting = false;
    let box = null;

    gridContainer.addEventListener('mousedown', (e) => {
      if (e.target.closest('#custom-context-menu') || 
          e.target.closest('#empty-space-context-menu') || 
          e.target.closest('#new-dropdown-menu') || 
          e.target.closest('#profile-dropdown-menu')) {
        return;
      }

      const isContextMenuOpen = !contextMenu.classList.contains('hidden') || !emptySpaceContextMenu.classList.contains('hidden');
      const isNewDropdownOpen = newDropdownMenu && !newDropdownMenu.classList.contains('hidden');
      const isProfileDropdownOpen = profileDropdownMenu && !profileDropdownMenu.classList.contains('hidden');

      if (isContextMenuOpen || isNewDropdownOpen || isProfileDropdownOpen) {
        contextMenu.classList.add('hidden');
        emptySpaceContextMenu.classList.add('hidden');
        if (newDropdownMenu) newDropdownMenu.classList.add('hidden');
        if (profileDropdownMenu) profileDropdownMenu.classList.add('hidden');
        return;
      }

      if (e.button !== 0 || e.target.closest('.grid-item') || e.target.closest('button') || e.target.closest('input')) return;
      e.preventDefault();
      
      startClientX = e.clientX;
      startClientY = e.clientY;
      isSelecting = true;
      clearSelection();

      box = document.createElement('div');
      box.className = 'selection-box';
      box.style.left = `${startClientX}px`;
      box.style.top = `${startClientY}px`;
      document.body.appendChild(box);
      document.body.classList.add('is-box-selecting');
    });

    document.addEventListener('mousemove', (e) => {
      if (!isSelecting || !box) return;

      const currentClientX = e.clientX;
      const currentClientY = e.clientY;

      const boxLeft = Math.min(startClientX, currentClientX);
      const boxTop = Math.min(startClientY, currentClientY);
      const boxWidth = Math.abs(startClientX - currentClientX);
      const boxHeight = Math.abs(startClientY - currentClientY);

      box.style.left = boxLeft + 'px';
      box.style.top = boxTop + 'px';
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
          document.body.classList.remove('is-box-selecting');
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
  const uploadProgressCloseBtn = document.getElementById('upload-progress-close-btn');
  const uploadProgressPauseBtn = document.getElementById('upload-progress-pause-btn');
  const uploadProgressToggleBtn = document.getElementById('upload-progress-toggle-btn');
  const uploadProgressBody = document.getElementById('upload-progress-body');
  const uploadQueueList = document.getElementById('upload-queue-list');
  const CHUNK_UPLOAD_CONCURRENCY = 3;
  const FILE_UPLOAD_CONCURRENCY = 2;
  const MAX_RENDERED_UPLOAD_ROWS = 250;
  const MAX_PENDING_UPLOAD_RECORDS = 400;
  let lastProgressUpdateAt = 0;
  let uploadSessionController = null;
  let uploadInProgress = false;
  let uploadCancelled = false;
  let uploadPaused = false;
  let uploadPauseReason = null;
  let uploadResumeWaiters = [];
  let reconnectTimer = null;
  let uploadStartedAt = 0;
  let uploadQueue = [];
  const uploadQueueByFile = new Map();
  const activeUploadIds = new Set();
  const uploadIdentityByFile = new Map();
  const PENDING_UPLOADS_KEY = 'harbor-drive-pending-uploads-v1';

  window.addEventListener('beforeunload', (e) => {
    if (!uploadInProgress) return;

    e.preventDefault();
    e.returnValue = '';
  });

  if (uploadProgressCloseBtn) {
    uploadProgressCloseBtn.addEventListener('click', async (e) => {
      if (!uploadInProgress) return;

      e.preventDefault();
      e.stopImmediatePropagation();
      const shouldCancel = await confirm('Cancel the current upload? Uploaded temporary chunks will be removed.');
      if (!shouldCancel) return;

      await cancelActiveUpload();
    }, true);
  }

  if (uploadProgressPauseBtn) {
    uploadProgressPauseBtn.addEventListener('click', () => {
      if (!uploadInProgress) return;
      if (uploadPaused) {
        resumeUpload();
      } else {
        pauseUpload('Paused by you', 'manual');
      }
    });
  }

  window.addEventListener('offline', () => {
    if (uploadInProgress && !uploadCancelled) {
      pauseUpload('Connection lost. Waiting to reconnect', 'network');
    }
  });

  window.addEventListener('online', () => {
    if (uploadInProgress && uploadPaused && uploadPauseReason === 'network') {
      resumeUpload();
    }
  });

  if (uploadProgressToggleBtn && uploadProgressBody) {
    uploadProgressToggleBtn.addEventListener('click', () => {
      const isCollapsed = uploadProgressBody.classList.toggle('hidden');
      const icon = uploadProgressToggleBtn.querySelector('i');
      if (icon) {
        icon.className = `bi ${isCollapsed ? 'bi-chevron-up' : 'bi-chevron-down'} text-base`;
      }
      uploadProgressToggleBtn.title = isCollapsed ? 'Expand upload list' : 'Collapse upload list';
    });
  }

  function startUploadSession() {
    uploadSessionController = new AbortController();
    uploadInProgress = true;
    uploadCancelled = false;
    uploadPaused = false;
    uploadPauseReason = null;
    uploadResumeWaiters = [];
    uploadStartedAt = 0;
    uploadQueue = [];
    uploadQueueByFile.clear();
    activeUploadIds.clear();
    uploadIdentityByFile.clear();
    updatePauseButton();
    if (uploadQueueList) uploadQueueList.replaceChildren();
  }

  function finishUploadSession() {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    uploadSessionController = null;
    uploadInProgress = false;
    uploadCancelled = false;
    uploadPaused = false;
    uploadPauseReason = null;
    uploadResumeWaiters.splice(0).forEach(resolve => resolve());
    uploadStartedAt = 0;
    activeUploadIds.clear();
    uploadIdentityByFile.clear();
    updatePauseButton();
  }

  async function cancelActiveUpload() {
    uploadCancelled = true;
    uploadSessionController?.abort();
    uploadResumeWaiters.splice(0).forEach(resolve => resolve());
    uploadProgressText.textContent = 'Cancelling upload...';
    updateProgress(0, 'Removing temporary chunks...', { force: true });

    await cleanupActiveUploadChunks();
    finishUploadSession();
    if (uploadProgressModal) uploadProgressModal.classList.add('hidden');
    if (uploadInput) uploadInput.value = '';
  }

  function updatePauseButton() {
    if (!uploadProgressPauseBtn) return;
    const icon = uploadProgressPauseBtn.querySelector('i');
    if (uploadPaused) {
      uploadProgressPauseBtn.title = 'Resume upload';
      uploadProgressPauseBtn.setAttribute('aria-label', 'Resume upload');
      if (icon) icon.className = 'bi bi-play-fill text-lg';
    } else {
      uploadProgressPauseBtn.title = 'Pause upload';
      uploadProgressPauseBtn.setAttribute('aria-label', 'Pause upload');
      if (icon) icon.className = 'bi bi-pause-fill text-lg';
    }
  }

  function pauseUpload(message, reason = 'manual') {
    if (!uploadInProgress || uploadCancelled) return;
    uploadPaused = true;
    uploadPauseReason = reason;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;

    uploadQueue.forEach(item => {
      if (item.status === 'uploading' || item.status === 'queued') {
        item.statusBeforePause = item.status;
        setUploadItemState(item.file, 'paused', item.progress);
      }
    });

    if (uploadProgressText) uploadProgressText.textContent = 'Upload paused';
    updateProgress(getAggregateUploadPercent(), message, { force: true });
    updatePauseButton();

    if (reason === 'network') {
      reconnectTimer = setTimeout(() => {
        if (uploadInProgress && uploadPaused && uploadPauseReason === 'network' && navigator.onLine) {
          resumeUpload();
        }
      }, 5000);
    }
  }

  function resumeUpload() {
    if (!uploadInProgress || !uploadPaused) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    uploadPaused = false;
    uploadPauseReason = null;

    uploadQueue.forEach(item => {
      if (item.status === 'paused') {
        setUploadItemState(item.file, item.statusBeforePause || 'uploading', item.progress);
        item.statusBeforePause = null;
      }
    });

    updatePauseButton();
    const waiters = uploadResumeWaiters.splice(0);
    waiters.forEach(resolve => resolve());
    updateUploadSummary({ force: true });
  }

  async function waitForUploadResume() {
    while (uploadPaused && !uploadCancelled) {
      await new Promise(resolve => uploadResumeWaiters.push(resolve));
    }
    if (uploadCancelled) throw new Error('Upload cancelled');
  }

  function isNetworkError(err) {
    return err instanceof TypeError ||
      err?.message === 'Failed to fetch' ||
      /network|fetch/i.test(err?.message || '');
  }

  async function fetchWithConnectionRecovery(url, options) {
    while (true) {
      await waitForUploadResume();
      try {
        return await fetch(url, options);
      } catch (err) {
        if (uploadCancelled || err.name === 'AbortError') throw err;
        if (!isNetworkError(err)) throw err;

        pauseUpload('Connection lost. Waiting to reconnect', 'network');
        await waitForUploadResume();
      }
    }
  }

  async function cleanupActiveUploadChunks() {
    const uploadIds = Array.from(activeUploadIds);
    if (uploadIds.length > 0) {
      await fetch('/api/upload/cancel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken
        },
        body: JSON.stringify({ uploadIds })
      }).catch(err => console.warn('Upload cleanup failed:', err));
    }
    uploadQueue.forEach(item => clearUploadIdentity(item.file));
    activeUploadIds.clear();
  }

  async function finishFailedUpload(err, message) {
    const wasCancelled = uploadCancelled || err?.name === 'AbortError' || err?.message === 'Upload cancelled';
    if (!wasCancelled) {
      uploadSessionController?.abort();
      console.error(err);
      if (message && !err?.uploadAlertShown) {
        alert(message);
      }
    }

    finishUploadSession();
    if (wasCancelled && uploadProgressModal) uploadProgressModal.classList.add('hidden');
  }

  function formatUploadDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return 'Calculating time left';
    if (seconds < 60) return `${Math.max(1, Math.ceil(seconds))} sec left`;

    const minutes = Math.ceil(seconds / 60);
    if (minutes < 60) return `${minutes} min left`;

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0
      ? `${hours} hr ${remainingMinutes} min left`
      : `${hours} hr left`;
  }

  function getUploadFileIcon(file) {
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    if (file.type.startsWith('video/')) return 'bi-file-earmark-play-fill text-red-500';
    if (file.type.startsWith('image/')) return 'bi-file-earmark-image-fill text-blue-500';
    if (file.type.startsWith('audio/')) return 'bi-file-earmark-music-fill text-pink-500';
    if (extension === 'pdf') return 'bi-file-earmark-pdf-fill text-red-500';
    if (['doc', 'docx'].includes(extension)) return 'bi-file-earmark-word-fill text-blue-600';
    if (['xls', 'xlsx', 'csv'].includes(extension)) return 'bi-file-earmark-excel-fill text-green-600';
    return 'bi-file-earmark-fill text-gray-500';
  }

  function prepareUploadQueue(files) {
    uploadQueue = files.map((file, index) => ({
      id: `upload-item-${index}`,
      file,
      status: 'queued',
      progress: 0,
      uploadedBytes: 0,
      row: null,
      statusIcon: null,
      progressText: null,
      progressBar: null
    }));

    uploadQueueByFile.clear();
    uploadQueue.forEach(item => uploadQueueByFile.set(item.file, item));
    renderUploadQueue();
    updateUploadSummary({ force: true });
  }

  function renderUploadQueue() {
    if (!uploadQueueList) return;
    uploadQueueList.replaceChildren();

    const renderedItems = uploadQueue.slice(0, MAX_RENDERED_UPLOAD_ROWS);
    renderedItems.forEach(item => {
      const row = document.createElement('div');
      row.className = 'flex items-center gap-3 px-4 py-2.5 min-h-14 text-gray-400';

      const fileIcon = document.createElement('i');
      fileIcon.className = `bi ${getUploadFileIcon(item.file)} text-lg shrink-0`;

      const details = document.createElement('div');
      details.className = 'min-w-0 flex-1';

      const name = document.createElement('div');
      name.className = 'text-sm font-medium truncate';
      name.textContent = item.file.name;

      const progressTrack = document.createElement('div');
      progressTrack.className = 'h-1 bg-gray-100 rounded-full overflow-hidden mt-1.5 hidden';

      const progressBar = document.createElement('div');
      progressBar.className = 'h-full bg-brand-teal transition-[width] duration-150 ease-out';
      progressBar.style.width = '0%';
      progressTrack.appendChild(progressBar);

      details.append(name, progressTrack);

      const status = document.createElement('div');
      status.className = 'w-12 shrink-0 text-right text-[11px] font-semibold text-gray-400';
      status.textContent = 'Queued';

      row.append(fileIcon, details, status);
      uploadQueueList.appendChild(row);

      item.row = row;
      item.statusIcon = status;
      item.progressText = progressTrack;
      item.progressBar = progressBar;
    });

    const hiddenCount = uploadQueue.length - renderedItems.length;
    if (hiddenCount > 0) {
      const summaryRow = document.createElement('div');
      summaryRow.className = 'px-4 py-3 text-xs font-semibold text-gray-500 bg-gray-50 border-t border-gray-100';
      summaryRow.textContent = `${hiddenCount} more file${hiddenCount === 1 ? '' : 's'} will upload in the background`;
      uploadQueueList.appendChild(summaryRow);
    }
  }

  function setUploadItemState(file, status, progress = 0) {
    const item = uploadQueueByFile.get(file);
    if (!item) return;

    if (uploadPaused && status === 'uploading') {
      item.statusBeforePause = 'uploading';
      status = 'paused';
    }

    item.status = status;
    item.progress = Math.max(0, Math.min(progress, 100));
    item.uploadedBytes = Math.round((item.progress / 100) * file.size);

    if (!item.row) {
      updateUploadSummary();
      return;
    }

    item.row.classList.toggle('text-gray-400', status === 'queued');
    item.row.classList.toggle('text-gray-800', status !== 'queued');
    item.progressText.classList.toggle('hidden', !['uploading', 'paused'].includes(status));
    item.progressBar.style.width = `${item.progress}%`;

    if (status === 'queued') {
      item.statusIcon.className = 'w-12 shrink-0 text-right text-[11px] font-semibold text-gray-400';
      item.statusIcon.textContent = 'Queued';
    } else if (status === 'uploading') {
      item.statusIcon.className = 'w-12 shrink-0 text-right text-[11px] font-semibold text-brand-teal';
      item.statusIcon.textContent = `${Math.round(item.progress)}%`;
    } else if (status === 'paused') {
      item.statusIcon.className = 'w-14 shrink-0 text-right text-[11px] font-semibold text-amber-700';
      item.statusIcon.textContent = 'Paused';
    } else if (status === 'finalizing') {
      item.statusIcon.className = 'w-16 shrink-0 text-right text-[11px] font-semibold text-brand-teal';
      item.statusIcon.textContent = 'Finalizing';
    } else if (status === 'complete') {
      item.statusIcon.className = 'w-8 shrink-0 flex justify-end text-green-600';
      item.statusIcon.innerHTML = '<i class="bi bi-check-circle-fill text-xl"></i>';
    } else if (status === 'failed') {
      item.statusIcon.className = 'w-8 shrink-0 flex justify-end text-red-500';
      item.statusIcon.innerHTML = '<i class="bi bi-exclamation-circle-fill text-xl"></i>';
    }

    updateUploadSummary();
  }

  function getAggregateUploadPercent() {
    if (uploadQueue.length === 0) return 0;
    const totalBytes = uploadQueue.reduce((sum, item) => sum + item.file.size, 0);
    const uploadedBytes = uploadQueue.reduce((sum, item) => sum + item.uploadedBytes, 0);
    return totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : 100;
  }

  function updateUploadSummary({ force = false } = {}) {
    if (uploadQueue.length === 0) return;

    const totalBytes = uploadQueue.reduce((sum, item) => sum + item.file.size, 0);
    const uploadedBytes = uploadQueue.reduce((sum, item) => sum + item.uploadedBytes, 0);
    const completed = uploadQueue.filter(item => item.status === 'complete').length;
    const failed = uploadQueue.filter(item => item.status === 'failed').length;
    const finalizing = uploadQueue.filter(item => item.status === 'finalizing').length;
    const paused = uploadQueue.filter(item => item.status === 'paused').length;
    const percent = totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : 100;

    if (uploadProgressText) {
      if (uploadPaused || paused > 0) {
        uploadProgressText.textContent = 'Upload paused';
      } else if (completed === uploadQueue.length) {
        uploadProgressText.textContent = `${completed} upload${completed === 1 ? '' : 's'} complete`;
      } else if (failed > 0) {
        uploadProgressText.textContent = `${failed} upload${failed === 1 ? '' : 's'} failed`;
      } else if (finalizing > 0 && completed + finalizing === uploadQueue.length) {
        uploadProgressText.textContent = `Finalizing ${finalizing} upload${finalizing === 1 ? '' : 's'}`;
      } else {
        uploadProgressText.textContent = `Uploading ${uploadQueue.length} item${uploadQueue.length === 1 ? '' : 's'}`;
      }
    }

    let detailText = 'Calculating time left';
    if (uploadPaused || paused > 0) {
      detailText = uploadPauseReason === 'network'
        ? 'Connection lost. Waiting to reconnect'
        : 'Select Resume to continue';
    } else if (finalizing > 0 && completed + finalizing === uploadQueue.length) {
      detailText = 'Completing upload';
    } else if (uploadStartedAt > 0 && uploadedBytes > 0 && uploadedBytes < totalBytes) {
      const elapsedSeconds = Math.max((Date.now() - uploadStartedAt) / 1000, 0.1);
      const bytesPerSecond = uploadedBytes / elapsedSeconds;
      detailText = `${formatUploadDuration((totalBytes - uploadedBytes) / bytesPerSecond)} - ${formatBytes(bytesPerSecond)}/s`;
    } else if (completed === uploadQueue.length) {
      detailText = 'All uploads finished';
    }

    updateProgress(percent, detailText, { force });
  }

  function getPendingUploads() {
    try {
      return JSON.parse(localStorage.getItem(PENDING_UPLOADS_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function savePendingUploads(pendingUploads) {
    try {
      const entries = Object.entries(pendingUploads)
        .sort((a, b) => (b[1]?.updatedAt || 0) - (a[1]?.updatedAt || 0))
        .slice(0, MAX_PENDING_UPLOAD_RECORDS);
      localStorage.setItem(PENDING_UPLOADS_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch (err) {
      console.warn('Upload resume metadata could not be saved:', err);
    }
  }

  function getUploadFingerprint(file, folderId) {
    return md5(`${file.name}:${file.size}:${file.lastModified}:${folderId ?? ''}`);
  }

  function getOrCreateUploadIdentity(file, folderId) {
    const fingerprint = getUploadFingerprint(file, folderId);
    const pendingUploads = getPendingUploads();
    const existing = pendingUploads[fingerprint];
    const uploadId = existing?.uploadId || (
      window.crypto?.randomUUID
        ? window.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`
    );

    pendingUploads[fingerprint] = {
      uploadId,
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      folderId: folderId ?? '',
      updatedAt: Date.now()
    };
    savePendingUploads(pendingUploads);

    const identity = { fingerprint, uploadId };
    uploadIdentityByFile.set(file, identity);
    return identity;
  }

  function clearUploadIdentity(file) {
    const identity = uploadIdentityByFile.get(file);
    if (!identity) return;
    const pendingUploads = getPendingUploads();
    delete pendingUploads[identity.fingerprint];
    savePendingUploads(pendingUploads);
    uploadIdentityByFile.delete(file);
  }

  async function runWithConcurrency(items, concurrency, worker) {
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        await waitForUploadResume();
        const index = nextIndex++;
        await worker(items[index], index);
      }
    });
    await Promise.all(workers);
  }

  if (uploadInput) {
    uploadInput.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);
      if (files.length === 0) return;
      if (!canWriteCurrentFolder()) {
        uploadInput.value = '';
        return;
      }

      if (window.primeNotificationSound) window.primeNotificationSound();
      startUploadSession();
      prepareUploadQueue(files);
      showProgressModal();
      
      try {
        await uploadFlatFiles(files, { deferStats: files.length > 1 });
        if (files.length > 1) await refreshUploadStats();
        uploadInput.value = '';
        await playUploadSuccessSound();
        finishUploadSession();
        window.location.reload();
      } catch (err) {
        await finishFailedUpload(err);
      }
    });
  }

  // Drag and Drop uploads
  const dragOverlay = document.getElementById('drag-overlay');
  if (dragOverlay) {
    let activeDropTarget = null;

    window.addEventListener('dragenter', (e) => {
      const types = Array.from(e.dataTransfer?.types || []);
      if (internalItemDrag || types.includes(DRIVE_ITEMS_MIME) || !types.includes('Files')) {
        return;
      }
      e.preventDefault();
      dragOverlay.classList.add('active');
    });

    dragOverlay.addEventListener('dragover', (e) => {
      e.preventDefault();

      dragOverlay.style.pointerEvents = 'none';
      const element = document.elementFromPoint(e.clientX, e.clientY);
      dragOverlay.style.pointerEvents = '';

      const dropTarget = element ? element.closest('.grid-item[data-type="folder"], .sidebar-folder-drop-target') : null;
      if (dropTarget !== activeDropTarget) {
        if (activeDropTarget) {
          activeDropTarget.classList.remove('is-drop-target');
        }
        activeDropTarget = dropTarget;
        if (activeDropTarget) {
          activeDropTarget.classList.add('is-drop-target');
        }
      }
    });

    dragOverlay.addEventListener('dragleave', (e) => {
      if (e.relatedTarget === null) {
        dragOverlay.classList.remove('active');
        if (activeDropTarget) {
          activeDropTarget.classList.remove('is-drop-target');
          activeDropTarget = null;
        }
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

    function yieldToBrowser() {
      return new Promise(resolve => setTimeout(resolve, 0));
    }

    function recordSkippedEntry(scanState, entry, err) {
      scanState.skipped = (scanState.skipped || 0) + 1;
      const entryName = entry?.fullPath || entry?.name || 'Unknown entry';
      console.warn(`Skipping dropped item "${entryName}":`, err);
    }

    // Recursive depth-first traversal of FileSystemEntry
    async function traverseEntry(entry, path = '', results = [], scanState = { count: 0, skipped: 0 }) {
      if (uploadCancelled) throw new Error('Upload cancelled');

      if (entry.isFile) {
        let file;
        try {
          file = await new Promise((resolve, reject) => entry.file(resolve, reject));
        } catch (err) {
          recordSkippedEntry(scanState, entry, err);
          return;
        }
        results.push({
          type: 'file',
          file: file,
          path: path
        });
        scanState.count += 1;
      } else if (entry.isDirectory) {
        const currentPath = path ? `${path}/${entry.name}` : entry.name;
        results.push({
          type: 'directory',
          name: entry.name,
          path: currentPath
        });
        scanState.count += 1;
        
        const dirReader = entry.createReader();
        let entries;
        try {
          entries = await readAllEntries(dirReader);
        } catch (err) {
          recordSkippedEntry(scanState, entry, err);
          return;
        }
        for (const childEntry of entries) {
          await traverseEntry(childEntry, currentPath, results, scanState);
        }
      }

      if (scanState.count > 0 && scanState.count % 100 === 0) {
        uploadProgressText.textContent = `Scanning dropped items... ${scanState.count} found`;
        updateProgress(0, `${scanState.count} items found`);
        await yieldToBrowser();
      }
    }

    dragOverlay.addEventListener('drop', async (e) => {
      e.preventDefault();
      dragOverlay.classList.remove('active');
      if (!canWriteCurrentFolder()) return;

      const destinationFolderId = activeDropTarget ? activeDropTarget.dataset.id : undefined;
      if (activeDropTarget) {
        activeDropTarget.classList.remove('is-drop-target');
        activeDropTarget = null;
      }

      if (window.clearSelection) window.clearSelection();
      if (window.primeNotificationSound) window.primeNotificationSound();
      startUploadSession();

      const items = Array.from(e.dataTransfer.items || []);
      const droppedFiles = Array.from(e.dataTransfer.files || []);
      const droppedEntries = items
        .filter(item => item.kind === 'file')
        .map(item => item.webkitGetAsEntry ? item.webkitGetAsEntry() : null)
        .filter(Boolean);
      const hasDroppedDirectory = droppedEntries.some(entry => entry.isDirectory);

      if (droppedFiles.length > 0 && !hasDroppedDirectory) {
        if (droppedFiles.length === 0) return;

        prepareUploadQueue(droppedFiles);
        showProgressModal();
        try {
          await uploadFlatFiles(droppedFiles, { 
            deferStats: droppedFiles.length > 1, 
            destinationFolderId 
          });
          if (droppedFiles.length > 1) await refreshUploadStats();
          await playUploadSuccessSound();
          finishUploadSession();
          window.location.reload();
        } catch (err) {
          await finishFailedUpload(err);
        }
        return;
      }

      if (items.length === 0) {
        finishUploadSession();
        return;
      }

      showProgressModal();
      uploadProgressText.textContent = 'Scanning dropped items...';

      const queue = [];
      let skippedScanEntries = 0;
      try {
        const scanState = { count: 0, skipped: 0 };
        for (const entry of droppedEntries) {
          await traverseEntry(entry, '', queue, scanState);
        }
        skippedScanEntries = scanState.skipped || 0;

        if (queue.length === 0 && droppedFiles.length > 0) {
          for (const file of droppedFiles) {
            queue.push({
              type: 'file',
              file,
              path: ''
            });
          }
        }
      } catch (err) {
        await finishFailedUpload(err, `Failed to scan files: ${err.message}`);
        return;
      }

      if (skippedScanEntries > 0) {
        updateProgress(0, `${skippedScanEntries} unreadable item${skippedScanEntries === 1 ? '' : 's'} skipped`, { force: true });
      }

      if (queue.length === 0) {
        if (droppedFiles.length > 0) {
          try {
            prepareUploadQueue(droppedFiles);
            await uploadFlatFiles(droppedFiles, { 
              deferStats: droppedFiles.length > 1,
              destinationFolderId
            });
            if (droppedFiles.length > 1) await refreshUploadStats();
            await playUploadSuccessSound();
            finishUploadSession();
            window.location.reload();
          } catch (err) {
            await finishFailedUpload(err);
          }
        } else if (uploadProgressModal) {
          finishUploadSession();
          uploadProgressModal.classList.add('hidden');
        }
        return;
      }

      const pathFolderIdMap = {
        '': destinationFolderId !== undefined ? destinationFolderId : (window.getCurrentFolderId ? window.getCurrentFolderId() : '')
      };
      const isLargeQueue = queue.length > 1;
      const directoryItems = queue.filter(item => item.type === 'directory');
      const fileItems = queue.filter(item => item.type === 'file');
      prepareUploadQueue(fileItems.map(item => item.file));

      try {
        for (let i = 0; i < directoryItems.length; i++) {
          if (uploadCancelled) throw new Error('Upload cancelled');

          const item = directoryItems[i];
          const parentPath = getParentPath(item.path);
          const parentFolderId = pathFolderIdMap[parentPath];
          uploadProgressText.textContent = `Creating folders (${i + 1} of ${directoryItems.length})`;

          const folderId = await createFolderOnServer(item.name, parentFolderId, { deferStats: isLargeQueue });
          pathFolderIdMap[item.path] = folderId;
        }

        await runWithConcurrency(fileItems, FILE_UPLOAD_CONCURRENCY, async (item) => {
          if (uploadCancelled) throw new Error('Upload cancelled');

          const parentFolderId = pathFolderIdMap[item.path];
          await uploadFileInChunks(item.file, parentFolderId, (percent) => {
            setUploadItemState(item.file, 'uploading', percent);
          }, { deferStats: isLargeQueue });
          setUploadItemState(item.file, 'complete', 100);
        });

        if (isLargeQueue) await refreshUploadStats();
        await playUploadSuccessSound();
        finishUploadSession();
        window.location.reload();
      } catch (err) {
        await finishFailedUpload(err, `Drop upload failed: ${err.message}`);
      }
    });
  }

  async function uploadFlatFiles(files, { deferStats = false, destinationFolderId = undefined } = {}) {
    await runWithConcurrency(files, FILE_UPLOAD_CONCURRENCY, async (file) => {
      if (uploadCancelled) throw new Error('Upload cancelled');

      await uploadFileInChunks(file, destinationFolderId, (percent) => {
        setUploadItemState(file, 'uploading', percent);
      }, { deferStats });
      setUploadItemState(file, 'complete', 100);
    });
  }

  // Helper to resolve parent path of a relative path
  function getParentPath(path) {
    const idx = path.lastIndexOf('/');
    if (idx === -1) return '';
    return path.substring(0, idx);
  }

  // Helper to create a folder on the server
  async function createFolderOnServer(name, parentId, { deferStats = false } = {}) {
    const res = await fetchWithConnectionRecovery('/api/folders', {
      method: 'POST',
      signal: uploadSessionController?.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken
      },
      body: JSON.stringify({ name, parentId, deferStats })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to create directory');
    }
    const data = await res.json();
    return data.folder.id;
  }

  // Sidebar folder upload button
  if (sidebarFolderUploadBtn) {
    sidebarFolderUploadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!canWriteCurrentFolder()) return;
      if (newDropdownMenu) newDropdownMenu.classList.add('hidden');
      const folderUploadInput = document.getElementById('folder-upload-input');
      if (folderUploadInput) folderUploadInput.click();
    });
  }

  const folderUploadInput = document.getElementById('folder-upload-input');
  if (folderUploadInput) {
    folderUploadInput.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);
      if (files.length === 0) return;
      if (!canWriteCurrentFolder()) {
        folderUploadInput.value = '';
        return;
      }

      if (window.primeNotificationSound) window.primeNotificationSound();
      startUploadSession();

      const queue = [];
      const seenDirs = new Set();

      files.forEach(file => {
        const relativePath = file.webkitRelativePath || '';
        const parts = relativePath.split('/');
        let currentPath = '';
        for (let i = 0; i < parts.length - 1; i++) {
          const dirName = parts[i];
          currentPath = currentPath ? `${currentPath}/${dirName}` : dirName;
          if (!seenDirs.has(currentPath)) {
            seenDirs.add(currentPath);
          }
        }
      });

      const sortedDirs = Array.from(seenDirs).sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));

      sortedDirs.forEach(dirPath => {
        const parts = dirPath.split('/');
        const dirName = parts[parts.length - 1];
        queue.push({
          type: 'directory',
          name: dirName,
          path: dirPath
        });
      });

      files.forEach(file => {
        const relativePath = file.webkitRelativePath || '';
        const parts = relativePath.split('/');
        queue.push({
          type: 'file',
          file: file,
          path: parts.slice(0, -1).join('/')
        });
      });

      const pathFolderIdMap = {
        '': window.getCurrentFolderId ? window.getCurrentFolderId() : ''
      };
      const isLargeQueue = queue.length > 1;
      const directoryItems = queue.filter(item => item.type === 'directory');
      const fileItems = queue.filter(item => item.type === 'file');
      prepareUploadQueue(fileItems.map(item => item.file));
      showProgressModal();

      try {
        for (let i = 0; i < directoryItems.length; i++) {
          if (uploadCancelled) throw new Error('Upload cancelled');

          const item = directoryItems[i];
          const parentPath = getParentPath(item.path);
          const parentFolderId = pathFolderIdMap[parentPath];
          uploadProgressText.textContent = `Creating folders (${i + 1} of ${directoryItems.length})`;

          const folderId = await createFolderOnServer(item.name, parentFolderId, { deferStats: isLargeQueue });
          pathFolderIdMap[item.path] = folderId;
        }

        await runWithConcurrency(fileItems, FILE_UPLOAD_CONCURRENCY, async (item) => {
          if (uploadCancelled) throw new Error('Upload cancelled');

          const parentFolderId = pathFolderIdMap[item.path];
          await uploadFileInChunks(item.file, parentFolderId, (percent) => {
            setUploadItemState(item.file, 'uploading', percent);
          }, { deferStats: isLargeQueue });
          setUploadItemState(item.file, 'complete', 100);
        });

        if (isLargeQueue) await refreshUploadStats();
        folderUploadInput.value = '';
        await playUploadSuccessSound();
        finishUploadSession();
        window.location.reload();
      } catch (err) {
        folderUploadInput.value = '';
        await finishFailedUpload(err, `Folder upload failed: ${err.message}`);
      }
    });
  }

  async function refreshUploadStats() {
    updateProgress(99, 'Finalizing upload totals...', { force: true });
    const res = await fetchWithConnectionRecovery('/api/upload/refresh-stats', {
      method: 'POST',
      signal: uploadSessionController?.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken
      },
      body: JSON.stringify({})
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to refresh upload totals');
    }
  }

  async function playUploadSuccessSound() {
    updateProgress(100, 'Upload complete', { force: true });
    if (window.playNotificationSound) {
      await window.playNotificationSound();
    }
  }

  function showProgressModal() {
    if (uploadProgressModal) uploadProgressModal.classList.remove('hidden');
    updateProgress(0, 'Preparing file slices...', { force: true });
  }

  function updateProgress(percent, detailText, { force = false } = {}) {
    const now = Date.now();
    if (!force && now - lastProgressUpdateAt < 100 && percent < 100) {
      return;
    }
    lastProgressUpdateAt = now;
    if (uploadProgressBar) uploadProgressBar.style.width = `${percent}%`;
    if (uploadProgressDetails) uploadProgressDetails.textContent = `${percent}% - ${detailText}`;
  }

  async function uploadFileInChunks(file, folderId, onProgress, { deferStats = false } = {}) {
    const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
    const resolvedFolderId = folderId !== undefined ? folderId : (window.getCurrentFolderId ? window.getCurrentFolderId() : '');
    const { uploadId } = getOrCreateUploadIdentity(file, resolvedFolderId);
    activeUploadIds.add(uploadId);
    let uploadCompleted = false;

    try {
      if (uploadStartedAt === 0) uploadStartedAt = Date.now();
      setUploadItemState(file, 'uploading', 0);

      // 1. Query server to see which chunks were already successfully uploaded
      const statusRes = await fetchWithConnectionRecovery(`/api/upload/status?uploadId=${encodeURIComponent(uploadId)}`, {
        signal: uploadSessionController?.signal
      });
      if (!statusRes.ok) throw new Error(`Upload status check failed with status ${statusRes.status}`);
      const statusData = await statusRes.json();
      if (statusData.completed) {
        uploadCompleted = true;
        clearUploadIdentity(file);
        return;
      }
      const uploadedChunks = new Set(statusData.uploadedChunks || []);

      // 2. Upload missing chunks with bounded concurrency.
      const missingChunkIndices = [];
      for (let i = 0; i < totalChunks; i++) {
        if (!uploadedChunks.has(i)) missingChunkIndices.push(i);
      }

      let completedChunks = uploadedChunks.size;
      if (completedChunks > 0 && onProgress) {
        onProgress(Math.round((completedChunks / totalChunks) * 100));
      }

      await runWithConcurrency(missingChunkIndices, CHUNK_UPLOAD_CONCURRENCY, async (i) => {
        await waitForUploadResume();
        if (uploadCancelled) throw new Error('Upload cancelled');
        const start = i * CHUNK_SIZE;
        const end = Math.min(file.size, start + CHUNK_SIZE);
        const chunkBlob = file.slice(start, end);

        const formData = new FormData();
        formData.append('uploadId', uploadId);
        formData.append('chunkIndex', i);
        formData.append('chunkOffset', start);
        formData.append('fileSize', file.size);
        formData.append('chunk', chunkBlob, `chunk_${i}`);

        await uploadChunkWithRetry(formData);

        completedChunks += 1;
        const percent = Math.min(98, Math.round((completedChunks / totalChunks) * 98));
        if (onProgress) onProgress(percent);
        else updateProgress(percent, `Uploaded chunk ${i + 1} of ${totalChunks}`);
      });

      // 3. Request final merge
      setUploadItemState(file, 'finalizing', 100);
      if (!onProgress) updateProgress(99, 'Verifying uploaded data on disk...', { force: true });
      
      const completeRes = await fetchWithConnectionRecovery('/api/upload/complete', {
        method: 'POST',
        signal: uploadSessionController?.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken
        },
        body: JSON.stringify({
          uploadId,
          totalChunks,
          filename: file.name,
          fileSize: file.size,
          folderId: resolvedFolderId,
          deferStats
        })
      });

      if (!completeRes.ok) {
        const errData = await completeRes.json().catch(() => ({}));
        throw new Error(errData.error || 'Merge request failed on the server');
      }
      uploadCompleted = true;
      clearUploadIdentity(file);

    } catch (err) {
      if (!uploadCancelled && err.name !== 'AbortError') {
        setUploadItemState(file, 'failed', 0);
        console.error(err);
        alert(`Upload stopped for ${file.name}: ${err.message}. Uploaded chunks were kept; select the same file again to resume.`);
        err.uploadAlertShown = true;
      }
      throw err;
    } finally {
      if (uploadCompleted) {
        activeUploadIds.delete(uploadId);
      }
    }
  }

  async function uploadChunkWithRetry(formData, attempt = 1) {
    try {
      await waitForUploadResume();
      const res = await fetchWithConnectionRecovery('/api/upload/chunk', {
        method: 'POST',
        signal: uploadSessionController?.signal,
        headers: {
          'x-csrf-token': csrfToken
        },
        body: formData
      });

      if (res.status === 429) {
        const retryAfterSeconds = parseInt(res.headers.get('Retry-After') || '', 10);
        const retryDelay = Number.isFinite(retryAfterSeconds)
          ? retryAfterSeconds * 1000
          : 5000 * attempt;
        throw Object.assign(new Error('Upload is being rate limited'), {
          isRateLimited: true,
          retryDelay
        });
      }

      if (!res.ok) throw new Error(`Status ${res.status}`);
    } catch (err) {
      if (err.name === 'AbortError' || uploadCancelled) throw err;

      if (attempt < 5) {
        const retryDelay = err.isRateLimited ? err.retryDelay : 1000 * attempt;
        console.warn(`Chunk upload retry attempt ${attempt}...`);
        await new Promise(r => setTimeout(r, retryDelay));
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
  window.selectAllDriveItems = selectAllItems;
  window.setSelectedDriveItems = setSelectedItems;
  window.getDriveSelectionPayload = getClipboardItemsFromSelection;
  window.formatBytes = formatBytes;
});
