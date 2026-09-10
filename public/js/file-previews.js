(() => {
  let pdfLibrary;
  function loadPdf() {
    if (!pdfLibrary) pdfLibrary = new Promise((resolve, reject) => {
      if (window.pdfjsLib) return resolve(window.pdfjsLib);
      const script = document.createElement('script');
      script.src = '/vendor/embedpdf/pdf.min.js';
      script.onload = () => resolve(window.pdfjsLib);
      script.onerror = () => reject(new Error('PDF preview unavailable'));
      document.head.append(script);
    });
    return pdfLibrary;
  }
  const textExtensions = new Set('txt md csv tsv json js ts jsx tsx html css xml sql py sh yaml yml log ini c cpp h java rs go'.split(' '));
  window.renderFilePreview = (host, file, { interactive = false } = {}) => {
    let disposed = false;
    let objectUrl;
    let pdfTask;
    let media;
    const controller = new AbortController();
    const name = file.name || '';
    const ext = name.split('.').pop().toLowerCase();
    const inferredMime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4' };
    const mime = file.mimeType || file.blob?.type || inferredMime[ext] || '';
    const kind = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video'
      : mime.startsWith('audio/') ? 'audio' : (ext === 'pdf' || mime === 'application/pdf') ? 'pdf'
      : (mime.startsWith('text/') || textExtensions.has(ext)) ? 'text' : 'other';
    host.replaceChildren();
    host.classList.add('file-preview-surface');
    const fallback = (message = 'Preview unavailable') => {
      if (disposed) return;
      host.replaceChildren();
      const label = document.createElement('span');
      label.className = 'file-preview-fallback';
      label.textContent = `${ext.toUpperCase() || 'FILE'} - ${message}`;
      const icon = document.createElement('i');
      icon.className = `bi ${kind === 'audio' ? 'bi-file-music' : 'bi-file-earmark'}`;
      icon.setAttribute('aria-hidden', 'true');
      label.prepend(icon);
      host.append(label);
    };
    const source = () => file.blob ? (objectUrl ||= URL.createObjectURL(file.blob)) : file.url;
    async function render() {
      if (kind === 'image' || kind === 'video' || (kind === 'audio' && interactive)) {
        media = document.createElement(kind === 'image' ? 'img' : kind);
        if (kind === 'image') media.alt = name;
        else {
          media.controls = interactive;
          media.preload = 'metadata';
          media.setAttribute('aria-label', name);
          if (kind === 'video') { media.muted = !interactive; media.playsInline = true; }
        }
        media.addEventListener('error', () => fallback(), { once: true });
        let mediaSource = source();
        if (kind === 'image' && !interactive && !file.blob) mediaSource += `${mediaSource.includes('?') ? '&' : '?'}thumbnail=400`;
        if (kind === 'video' && !interactive) mediaSource += '#t=0.1';
        media.src = mediaSource;
        host.append(media);
      } else if (kind === 'pdf') {
        if (file.size > 20 * 1024 * 1024) return fallback(interactive ? 'PDF is too large for an inline preview' : 'Open file to preview');
        fallback('Loading preview...');
        const pdf = await loadPdf();
        if (disposed) return;
        pdf.GlobalWorkerOptions.workerSrc = '/vendor/embedpdf/pdf.worker.min.js';
        const input = file.blob ? { data: new Uint8Array(await file.blob.arrayBuffer()) } : { url: file.url };
        if (disposed) return;
        pdfTask = pdf.getDocument({ ...input, isEvalSupported: false });
        const documentPdf = await pdfTask.promise;
        const page = await documentPdf.getPage(1);
        if (disposed) return;
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(2, 500 / base.width) });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width; canvas.height = viewport.height;
        canvas.setAttribute('aria-label', `First page of ${name}`);
        canvas.setAttribute('role', 'img');
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        if (!disposed) host.replaceChildren(canvas);
        await pdfTask.destroy();
        pdfTask = null;
      } else if (kind === 'text') {
        let text;
        if (file.blob) text = await file.blob.slice(0, 4096).text();
        else {
          const response = await fetch(file.url, { headers: { Range: 'bytes=0-4095' }, signal: controller.signal });
          if (!response.ok) throw new Error('Preview unavailable');
          const reader = response.body.getReader();
          const chunks = []; let length = 0;
          try {
            while (length < 4096) {
              const { done, value } = await reader.read();
              if (done) break;
              const chunk = value.subarray(0, 4096 - length);
              chunks.push(chunk); length += chunk.length;
            }
          } finally { await reader.cancel(); }
          const bytes = new Uint8Array(length); let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
          text = new TextDecoder().decode(bytes);
        }
        if (disposed) return;
        const pre = document.createElement('pre');
        pre.textContent = text || '(Empty file)';
        pre.setAttribute('aria-label', `Beginning of ${name}`);
        host.replaceChildren(pre);
      } else fallback(kind === 'audio' ? 'Audio file' : interactive ? 'No inline preview for this format' : 'Open file to preview');
    }
    const ready = render().catch(() => fallback());
    return { ready, dispose() {
      disposed = true; controller.abort();
      if (media && kind !== 'image') { media.pause(); media.removeAttribute('src'); media.load(); }
      pdfTask?.destroy().catch(() => {});
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      host.replaceChildren();
    } };
  };
  const pending = [];
  let running = 0;
  function drain() {
    while (running < 3 && pending.length) {
      const host = pending.shift();
      if (!host.isConnected) continue;
      running++;
      const preview = window.renderFilePreview(host, { name: host.dataset.previewName,
        mimeType: host.dataset.previewMime, url: host.dataset.previewSource, size: Number(host.dataset.previewSize) });
      host._filePreview = preview;
      preview.ready.finally(() => { running--; drain(); });
    }
  }
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      observer.unobserve(entry.target); pending.push(entry.target);
    }
    drain();
  }, { rootMargin: '100px' });
  function discover(root) {
    if (root.matches?.('[data-preview-source]')) observer.observe(root);
    root.querySelectorAll?.('[data-preview-source]').forEach(host => observer.observe(host));
  }
  discover(document);
  new MutationObserver(records => {
    for (const record of records) {
      record.addedNodes.forEach(discover);
      record.removedNodes.forEach(root => {
        const clear = host => { observer.unobserve(host); host._filePreview?.dispose(); };
        if (root.matches?.('[data-preview-source]')) clear(root);
        root.querySelectorAll?.('[data-preview-source]').forEach(clear);
      });
    }
  }).observe(document.body, { childList: true, subtree: true });
})();
