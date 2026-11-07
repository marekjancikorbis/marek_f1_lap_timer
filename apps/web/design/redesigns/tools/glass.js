// Liquid glass, built per element (inlined into src/glass.html at build time):
//  - a displacement map sized to the element: inside a rim band the backdrop is pulled inward along the edge
//    normal, strongest at the edge and fading to nothing (a convex edge profile), so corners bend correctly;
//    three passes at slightly different strengths split the colours a little at the rim;
//  - it materializes by ramping the bending up from zero;
//  - the rim light follows the pointer; a press lights the glass from the touch point.
(() => {
  const root = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const glass = [...document.querySelectorAll('.glass')];

  glass.forEach((el) => {
    el.addEventListener('pointerdown', (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--px', `${((e.clientX - r.left) / r.width) * 100}%`);
      el.style.setProperty('--py', `${((e.clientY - r.top) / r.height) * 100}%`);
      el.classList.add('pressed');
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, () => el.classList.remove('pressed'));
  });

  addEventListener('pointermove', (e) => {
    const a = Math.atan2(e.clientY - innerHeight / 2, e.clientX - innerWidth / 2) * 180 / Math.PI + 90;
    glass.forEach((el) => el.style.setProperty('--light', `${a + 180}deg`));
  }, { passive: true });

  if (!root.classList.contains('lens')) return;
  const defs = document.getElementById('lens-defs');
  const maps = new Map();

  function displacementMap(w, h, r, band) {
    const key = `${w}x${h}x${r}x${band}`;
    if (maps.has(key)) return maps.get(key);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'), img = ctx.createImageData(w, h), d = img.data;
    const hx = w / 2 - r, hy = h / 2 - r;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const px = x + .5 - w / 2, py = y + .5 - h / 2;
      const qx = Math.abs(px) - hx, qy = Math.abs(py) - hy;
      // signed distance to the rounded rectangle (negative inside) and its outward normal
      let dist, nx, ny;
      if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy); dist = l - r; nx = qx / l; ny = qy / l; }
      else if (qx > qy) { dist = qx - r; nx = 1; ny = 0; }
      else { dist = qy - r; nx = 0; ny = 1; }
      nx *= Math.sign(px) || 1; ny *= Math.sign(py) || 1;
      const inside = -dist, i = (y * w + x) * 4;
      let m = 0;
      if (inside >= 0 && inside < band) { const t = 1 - inside / band; m = t * t * (3 - 2 * t) * t; } // eased, steepest at the edge
      d[i] = 128 + nx * m * 127; d[i + 1] = 128 + ny * m * 127; d[i + 2] = 128; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const url = c.toDataURL();
    maps.set(key, url);
    return url;
  }

  const ramps = [];
  glass.forEach((el, n) => {
    const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
    if (!w || !h) return;
    const r = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, w / 2, h / 2);
    const round = Math.abs(w - h) < 2 && r >= w / 2 - 1;
    const band = round ? w / 2 : Math.min(30, h / 2);
    const k = round ? 18 : el.classList.contains('sheet') ? 26 : 24; // strongest pull, px
    const id = `lens-${n}`;
    const pass = (s, ch, out) =>
      `<feDisplacementMap in="SourceGraphic" in2="m" scale="0" data-to="${(-2 * k * s).toFixed(1)}" xChannelSelector="R" yChannelSelector="G" result="d${out}"/>` +
      `<feColorMatrix in="d${out}" type="matrix" values="${ch}" result="${out}"/>`;
    defs.insertAdjacentHTML('beforeend',
      `<filter id="${id}" x="0" y="0" width="${w}" height="${h}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">` +
      `<feImage href="${displacementMap(w, h, Math.round(r), Math.round(band))}" x="0" y="0" width="${w}" height="${h}" result="m"/>` +
      pass(1, '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0', 'r') +
      pass(.97, '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0', 'g') +
      pass(.94, '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0', 'b') +
      `<feBlend in="r" in2="g" mode="screen" result="rg"/><feBlend in="rg" in2="b" mode="screen"/></filter>`);
    el.style.setProperty('--lens', `url(#${id})`);
    ramps.push(...defs.lastElementChild.querySelectorAll('feDisplacementMap'));
  });

  // materialize: the bending ramps in from nothing
  const set = (f) => ramps.forEach((m) => m.setAttribute('scale', (m.dataset.to * f).toFixed(1)));
  if (reduce) return set(1);
  const t0 = performance.now();
  const step = (now) => { const t = Math.min(1, (now - t0) / 700); set(1 - (1 - t) ** 3); if (t < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
})();
