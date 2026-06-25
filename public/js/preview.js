// Client-side file preview initializations
document.addEventListener('DOMContentLoaded', async () => {
  const previewDataEl = document.getElementById('preview-metadata');
  if (!previewDataEl) return;

  const fileId = previewDataEl.dataset.fileId;
  const fileType = previewDataEl.dataset.type;
  const fileName = previewDataEl.dataset.name;

  // 1. IMAGE PREVIEW (LightGallery)
  if (fileType === 'image') {
    const lgEl = document.getElementById('lightgallery-container');
    if (lgEl && typeof lightGallery !== 'undefined') {
      lightGallery(lgEl, {
        selector: '.lg-item',
        download: true,
        zoom: true,
        alignHtml: 'center',
        mobileSettings: { controls: true, showCloseIcon: true }
      });
      // Click immediately to open viewer
      document.querySelector('.lg-item')?.click();
    }
  }

  // 2. EXCEL PREVIEW
  if (fileType === 'excel') {
    const container = document.getElementById('excel-container');
    if (container) {
      container.innerHTML = '<div class="text-center py-8 text-gray-400">Loading spreadsheet data...</div>';
      try {
        const streamUrl = `/preview/stream/${fileId}`;
        const response = await fetch(streamUrl);
        const arrayBuffer = await response.arrayBuffer();

        // Use global ExcelViewer from SuperYesifang
        if (typeof ExcelViewer !== 'undefined') {
          new ExcelViewer(container, arrayBuffer);
        } else if (typeof XLSX !== 'undefined') {
          // Fallback to SheetJS XLSX rendering
          const data = new Uint8Array(arrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          
          let html = '<div class="flex space-x-4 border-b border-gray-700 pb-2 mb-4 overflow-x-auto">';
          workbook.SheetNames.forEach((sheetName, index) => {
            html += `<button class="sheet-tab px-4 py-2 text-sm font-semibold rounded-lg ${index === 0 ? 'bg-teal-600 text-white' : 'text-gray-400 hover:text-white'}" data-index="${index}">${sheetName}</button>`;
          });
          html += '</div>';

          workbook.SheetNames.forEach((sheetName, index) => {
            const worksheet = workbook.Sheets[sheetName];
            const sheetHtml = XLSX.utils.sheet_to_html(worksheet, { header: '', footer: '' });
            html += `<div class="sheet-content overflow-auto ${index === 0 ? '' : 'hidden'}" id="sheet-${index}">${sheetHtml}</div>`;
          });

          container.innerHTML = html;

          // Wire sheet tab switching
          const tabs = container.querySelectorAll('.sheet-tab');
          tabs.forEach(tab => {
            tab.addEventListener('click', () => {
              tabs.forEach(t => t.className = 'sheet-tab px-4 py-2 text-sm font-semibold rounded-lg text-gray-400 hover:text-white');
              tab.className = 'sheet-tab px-4 py-2 text-sm font-semibold rounded-lg bg-teal-600 text-white';
              
              const idx = tab.dataset.index;
              container.querySelectorAll('.sheet-content').forEach(c => c.classList.add('hidden'));
              container.querySelector(`#sheet-${idx}`).classList.remove('hidden');
            });
          });
        }
      } catch (err) {
        container.innerHTML = `<div class="text-red-500 py-8">Failed to render spreadsheet: ${err.message}</div>`;
      }
    }
  }

  // 3. MARKDOWN PREVIEW (Marked)
  if (fileType === 'markdown') {
    const rawEl = document.getElementById('markdown-raw');
    const contentEl = document.getElementById('markdown-content');
    if (rawEl && contentEl && typeof marked !== 'undefined') {
      const rawText = rawEl.value;
      contentEl.innerHTML = marked.parse(rawText);
    }
  }

  // 4. CODE PREVIEW (js-beautify)
  if (fileType === 'code') {
    const rawEl = document.getElementById('code-raw');
    const contentEl = document.getElementById('code-content');
    if (rawEl && contentEl) {
      const rawCode = rawEl.value;
      let formatted = rawCode;
      
      const ext = fileName.split('.').pop().toLowerCase();
      
      // Run formatter based on extension
      if (typeof js_beautify !== 'undefined') {
        const opts = { indent_size: 2, space_in_empty_paren: true };
        if (['js', 'ts', 'json'].includes(ext)) {
          formatted = js_beautify(rawCode, opts);
        } else if (['html', 'xml'].includes(ext)) {
          formatted = html_beautify(rawCode, opts);
        } else if (['css'].includes(ext)) {
          formatted = css_beautify(rawCode, opts);
        }
      }

      // Add line numbers manually for a clean pretty read-only layout
      const lines = formatted.split('\n');
      let lineNumberedHtml = '<table class="w-full text-left font-mono text-sm">';
      lines.forEach((line, index) => {
        const escaped = escapeHtml(line);
        lineNumberedHtml += `
          <tr class="hover:bg-gray-800">
            <td class="text-gray-500 pr-4 border-r border-gray-700 text-right select-none w-10 vertical-top">${index + 1}</td>
            <td class="pl-4 whitespace-pre font-mono">${escaped || ' '}</td>
          </tr>
        `;
      });
      lineNumberedHtml += '</table>';
      
      contentEl.innerHTML = lineNumberedHtml;
    }
  }

  function escapeHtml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
});
