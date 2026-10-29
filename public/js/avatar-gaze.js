(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const avatars = [];
  const responses = new Map();
  let pointer = null;
  let frame = null;

  function render() {
    frame = null;
    avatars.forEach(({ svg, eyes }) => {
      let x = 0;
      let y = 0;
      if (pointer && !reducedMotion.matches) {
        const box = svg.getBoundingClientRect();
        if (!box.width || !box.height) return;
        const dx = (pointer.x - box.left - box.width / 2) / box.width;
        const dy = (pointer.y - box.top - box.height / 2) / box.height;
        const distance = Math.hypot(dx, dy);
        const travel = Math.min(distance * 3, 3.5);
        if (distance) {
          x = dx / distance * travel;
          y = dy / distance * travel;
        }
      }
      // The SVG viewBox uses 100 units, so movement stays proportional at any size.
      eyes.style.transition = reducedMotion.matches ? 'none' : 'transform 100ms ease-out';
      eyes.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
    });
  }

  function schedule() {
    if (!avatars.length) return;
    if (frame === null) frame = requestAnimationFrame(render);
  }

  window.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch' || reducedMotion.matches) return;
    pointer = { x: event.clientX, y: event.clientY };
    schedule();
  }, { passive: true });
  window.addEventListener('blur', () => { pointer = null; schedule(); });
  document.documentElement.addEventListener('pointerleave', () => { pointer = null; schedule(); });
  window.addEventListener('scroll', schedule, { capture: true, passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  reducedMotion.addEventListener('change', schedule);

  document.querySelectorAll('img[data-blobatar-gaze]').forEach(async image => {
    try {
      if (!responses.has(image.src)) {
        responses.set(image.src, fetch(image.src, { credentials: 'same-origin' }).then(async response => {
          if (!response.ok || !response.headers.get('content-type')?.includes('image/svg+xml')) return null;
          return response.text();
        }));
      }
      const markup = await responses.get(image.src);
      if (!markup || !image.isConnected) return;
      const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
      const svg = parsed.documentElement;
      if (svg.localName !== 'svg') return;
      // Blobatar's static renderer puts its eye paths in the final top-level group.
      const eyes = Array.from(svg.children).filter(child => child.localName === 'g').at(-1);
      if (!eyes) return;
      svg.setAttribute('class', image.className);
      if (image.alt) {
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', image.alt);
      } else {
        svg.setAttribute('aria-hidden', 'true');
      }
      svg.setAttribute('focusable', 'false');
      svg.style.pointerEvents = 'none';
      image.replaceWith(svg);
      avatars.push({ svg, eyes });
      schedule();
    } catch {
      // Keep the ordinary avatar image if enhancement is unavailable.
    }
  });
})();
