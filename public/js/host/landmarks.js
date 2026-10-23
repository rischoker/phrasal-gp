// Low-poly landmarks so every circuit feels like its city. Units: 1 tile = 4 units.
// Each builder returns { group, radius, height, animate? } — the group sits on y = 0, centred on its footprint.
import * as THREE from 'three';

const M = {};
function mat(color, opts = {}) {
  const k = color + JSON.stringify(opts);
  if (!M[k]) M[k] = new THREE.MeshLambertMaterial(Object.assign({ color, flatShading: true }, opts));
  return M[k];
}
function mesh(geo, color, x = 0, y = 0, z = 0, opts) {
  const m = new THREE.Mesh(geo, color && color.isMaterial ? color : mat(color, opts));
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  return m;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg);
const cone = (r, h, seg = 12) => new THREE.ConeGeometry(r, h, seg);

function plaza(g, r, color = 0xd8d2c4) { g.add(mesh(cyl(r, r, 0.12, 24), color, 0, 0.06, 0)); }

// Tapered 4-legged lattice tower (Eiffel / Tokyo Tower)
function latticeTower(g, { h, base, top, color, color2, bands = 0, platforms = [] }) {
  const legs = 4, segs = 8;
  for (let l = 0; l < legs; l++) {
    const a = Math.PI / 4 + l * Math.PI / 2;
    for (let s = 0; s < segs; s++) {
      const t0 = s / segs, t1 = (s + 1) / segs;
      const r0 = base + (top - base) * Math.pow(t0, 0.55), r1 = base + (top - base) * Math.pow(t1, 0.55);
      const p0 = new THREE.Vector3(Math.cos(a) * r0, t0 * h, Math.sin(a) * r0), p1 = new THREE.Vector3(Math.cos(a) * r1, t1 * h, Math.sin(a) * r1);
      const len = p0.distanceTo(p1);
      const c = color2 && bands && Math.floor(s * bands / segs) % 2 ? color2 : color;
      const leg = mesh(box(0.22, len, 0.22), c);
      leg.position.copy(p0).lerp(p1, 0.5);
      leg.lookAt(p1); leg.rotateX(Math.PI / 2);
      g.add(leg);
      if (s % 2 === 0) { // cross braces
        const b2 = new THREE.Vector3(Math.cos(a + Math.PI / 2) * r0, t0 * h, Math.sin(a + Math.PI / 2) * r0);
        const br = mesh(box(0.08, p0.distanceTo(b2), 0.08), c);
        br.position.copy(p0).lerp(b2, 0.5); br.lookAt(b2); br.rotateX(Math.PI / 2); g.add(br);
      }
    }
  }
  for (const [ty, col] of platforms) {
    const r = base + (top - base) * Math.pow(ty, 0.55);
    g.add(mesh(box(r * 1.55, 0.22, r * 1.55), col || color, 0, ty * h, 0));
  }
}

const B = {
  // ---------- Boston: Bunker Hill Monument + Old State House ----------
  boston() {
    const g = new THREE.Group();
    plaza(g, 3.2, 0x7fae64);
    g.add(mesh(box(2.2, 0.4, 2.2), 0xb9b3a8, 0, 0.2, 0));
    const ob = mesh(cyl(0.38, 0.75, 7.2, 4), 0xc9c3b6, 0, 4.0, 0); ob.rotation.y = Math.PI / 4; g.add(ob);
    const tip = mesh(cone(0.45, 0.7, 4), 0xc9c3b6, 0, 7.95, 0); tip.rotation.y = Math.PI / 4; g.add(tip);
    // Old State House (brick with white steeple)
    const h = new THREE.Group(); h.position.set(3.4, 0, 1.6);
    h.add(mesh(box(2.2, 1.8, 1.4), 0xa5442f, 0, 0.9, 0));
    h.add(mesh(cone(1.4, 0.7, 4), 0x3b3b44, 0, 2.15, 0)); h.children[1].rotation.y = Math.PI / 4; h.children[1].scale.set(1.1, 1, 0.75);
    h.add(mesh(box(0.6, 0.9, 0.6), 0xf2efe6, 0, 2.8, 0));
    h.add(mesh(cyl(0.22, 0.3, 0.7, 8), 0xf2efe6, 0, 3.55, 0));
    h.add(mesh(cone(0.18, 0.6, 8), 0xd4af37, 0, 4.2, 0));
    g.add(h);
    return { group: g, radius: 4.6, height: 8.3 };
  },

  // ---------- Bogotá: Catedral Primada (Plaza de Bolívar) + Monserrate in the background ----------
  bogota() {
    const g = new THREE.Group();
    plaza(g, 4.2, 0xb8b0a2);
    const white = 0xf3efe6, roof = 0x8a8f99;
    g.add(mesh(box(4.4, 3.0, 2.2), white, 0, 1.5, -1.0));
    g.add(mesh(box(4.6, 0.25, 2.4), 0xd6cfc0, 0, 3.1, -1.0));
    g.add(mesh(cone(1.7, 1.0, 3), white, 0, 3.7, 0.1)); g.children[g.children.length - 1].rotation.set(0, Math.PI, 0); // pediment
    for (const sx of [-1, 1]) {
      g.add(mesh(box(1.1, 4.4, 1.1), white, sx * 2.2, 2.2, 0.05));
      g.add(mesh(box(1.2, 0.2, 1.2), 0xd6cfc0, sx * 2.2, 4.45, 0.05));
      g.add(mesh(cyl(0.45, 0.5, 0.8, 8), white, sx * 2.2, 4.95, 0.05));
      g.add(mesh(new THREE.SphereGeometry(0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), roof, sx * 2.2, 5.35, 0.05));
      g.add(mesh(cyl(0.04, 0.04, 0.6, 4), 0xd4af37, sx * 2.2, 6.0, 0.05));
    }
    g.add(mesh(box(1.0, 1.6, 0.1), 0x5b3a25, 0, 0.8, 0.12)); // door
    // Bolívar statue on the plaza
    g.add(mesh(box(0.7, 1.0, 0.7), 0xb9b3a8, 0, 0.5, 2.6));
    g.add(mesh(cyl(0.18, 0.22, 0.9, 6), 0x5f6b55, 0, 1.45, 2.6));
    g.add(mesh(new THREE.SphereGeometry(0.17, 8, 6), 0x5f6b55, 0, 2.0, 2.6));
    return { group: g, radius: 4.6, height: 6.2 };
  },

  // ---------- Monte Carlo: Casino de Monte-Carlo ----------
  monaco() {
    const g = new THREE.Group();
    plaza(g, 4.4, 0x8cbf6a);
    const cream = 0xf1e3c4, copper = 0x5fae9a;
    g.add(mesh(box(5.6, 2.4, 2.6), cream, 0, 1.2, -0.8));
    g.add(mesh(box(5.8, 0.25, 2.8), 0xe0cfa9, 0, 2.5, -0.8));
    for (const sx of [-1, 1]) {
      g.add(mesh(box(1.3, 3.6, 1.3), cream, sx * 2.6, 1.8, -0.2));
      g.add(mesh(cone(0.95, 1.5, 4), copper, sx * 2.6, 4.35, -0.2)); g.children[g.children.length - 1].rotation.y = Math.PI / 4;
      g.add(mesh(cyl(0.05, 0.05, 0.6, 4), 0xd4af37, sx * 2.6, 5.35, -0.2));
    }
    g.add(mesh(cyl(0.9, 1.0, 0.8, 16), cream, 0, 2.9, -0.8));
    g.add(mesh(new THREE.SphereGeometry(0.95, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), copper, 0, 3.3, -0.8));
    g.add(mesh(cyl(0.05, 0.05, 0.5, 4), 0xd4af37, 0, 4.4, -0.8));
    for (let i = -2; i <= 2; i++) g.add(mesh(box(0.55, 1.2, 0.08), 0x3d5a73, i * 0.95, 1.0, 0.55)); // arched windows
    // fountain + palms in front
    g.add(mesh(cyl(1.2, 1.25, 0.3, 20), 0xe8e2d4, 0, 0.15, 2.4));
    g.add(mesh(cyl(1.0, 1.0, 0.05, 20), 0x4fb3d9, 0, 0.32, 2.4));
    g.add(mesh(cyl(0.12, 0.18, 0.9, 8), 0xe8e2d4, 0, 0.6, 2.4));
    for (const sx of [-1, 1]) {
      g.add(mesh(cyl(0.1, 0.14, 2.4, 6), 0x9a7a4e, sx * 3.4, 1.2, 2.2));
      g.add(mesh(cone(1.0, 0.45, 7), 0x3f9a45, sx * 3.4, 2.5, 2.2));
    }
    return { group: g, radius: 4.6, height: 5.6 };
  },

  // ---------- Tokyo: Tokyo Tower ----------
  tokyo() {
    const g = new THREE.Group();
    plaza(g, 3.0, 0x2a3042);
    latticeTower(g, { h: 9.0, base: 1.9, top: 0.18, color: 0xe8461f, color2: 0xf4f4f4, bands: 8, platforms: [[0.42, 0xf4f4f4], [0.7, 0xe8461f]] });
    g.traverse(o => { if (o.isMesh && o.material.color && o.material.color.getHex() !== 0x2a3042) { const c = o.material.color.getHex(); o.material = mat(c, { emissive: c === 0xe8461f ? 0xff5a20 : 0xffe9c0, emissiveIntensity: 0.55 }); } });
    g.add(mesh(cyl(0.05, 0.12, 1.6, 6), 0xf4f4f4, 0, 9.8, 0));
    // red beacon lights
    const bulbs = [];
    for (const y of [3.8, 6.3, 10.5]) { const b = mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3020 }), 0, y, 0); g.add(b); bulbs.push(b); }
    return { group: g, radius: 3.0, height: 10.6, animate: t => bulbs.forEach((b, i) => { b.visible = Math.sin(t * 3 + i) > -0.3; }) };
  },

  // ---------- London: Big Ben + London Eye + red bus ----------
  london() {
    const g = new THREE.Group();
    plaza(g, 4.6, 0x7bb066);
    const stone = 0xd9c48f;
    const t = new THREE.Group(); t.position.set(-2.0, 0, -0.4);
    t.add(mesh(box(1.3, 5.6, 1.3), stone, 0, 2.8, 0));
    t.add(mesh(box(1.5, 1.4, 1.5), stone, 0, 6.3, 0));
    for (let i = 0; i < 4; i++) { // clock faces
      const a = i * Math.PI / 2; const f = mesh(new THREE.CircleGeometry(0.5, 20), new THREE.MeshBasicMaterial({ color: 0xfff6d8 }), Math.sin(a) * 0.76, 6.3, Math.cos(a) * 0.76); f.rotation.y = a; t.add(f);
      const hand = mesh(box(0.05, 0.4, 0.02), 0x222222, Math.sin(a) * 0.78, 6.4, Math.cos(a) * 0.78); hand.rotation.y = a; t.add(hand);
    }
    t.add(mesh(box(1.1, 0.9, 1.1), stone, 0, 7.45, 0));
    const sp = mesh(cone(0.85, 2.4, 4), 0x3a4a3f, 0, 9.1, 0); sp.rotation.y = Math.PI / 4; t.add(sp);
    t.add(mesh(cyl(0.03, 0.03, 0.6, 4), 0xd4af37, 0, 10.5, 0));
    g.add(t);
    // London Eye
    const eye = new THREE.Group(); eye.position.set(2.3, 3.4, -0.6);
    const wheel = new THREE.Group(); eye.add(wheel);
    wheel.add(mesh(new THREE.TorusGeometry(3.0, 0.07, 6, 48), 0xf0f0f0));
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2;
      const sp2 = mesh(box(0.03, 3.0, 0.03), 0xdddddd, Math.cos(a) * 1.5, Math.sin(a) * 1.5, 0); sp2.rotation.z = a - Math.PI / 2; wheel.add(sp2);
      const pod = mesh(new THREE.SphereGeometry(0.17, 8, 6), 0xbfe4ff, Math.cos(a) * 3.05, Math.sin(a) * 3.05, 0.12); pod.scale.set(1, 0.8, 1.6); wheel.add(pod);
    }
    for (const sz of [-1, 1]) { const leg = mesh(box(0.12, 4.2, 0.12), 0xdddddd, 0, -1.6, sz * 0.9); leg.rotation.x = sz * 0.35; eye.add(leg); }
    eye.rotation.y = -0.5;
    g.add(eye);
    // double-decker bus
    const bus = new THREE.Group(); bus.position.set(-0.2, 0, 3.0); bus.rotation.y = 0.2;
    bus.add(mesh(box(2.4, 1.3, 0.8), 0xd6261c, 0, 0.8, 0));
    bus.add(mesh(box(2.42, 0.22, 0.82), 0x2a2f3a, 0, 0.75, 0));
    bus.add(mesh(box(2.42, 0.22, 0.82), 0x2a2f3a, 0, 1.25, 0));
    for (const wx of [-0.8, 0.8]) for (const wz of [-0.4, 0.4]) { const w = mesh(cyl(0.2, 0.2, 0.12, 10), 0x111111, wx, 0.2, wz); w.rotation.x = Math.PI / 2; bus.add(w); }
    g.add(bus);
    return { group: g, radius: 5.3, height: 10.6, animate: tt => { wheel.rotation.z = tt * 0.08; } };
  },

  // ---------- Paris: Eiffel Tower + Arc de Triomphe ----------
  paris() {
    const g = new THREE.Group();
    plaza(g, 4.6, 0x9cc77a);
    const iron = 0x7a5a3c;
    const e = new THREE.Group(); e.position.set(-1.4, 0, -0.6);
    latticeTower(e, { h: 10.5, base: 2.2, top: 0.12, color: iron, platforms: [[0.2, iron], [0.5, iron]] });
    // arches between legs
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; const ar = mesh(new THREE.TorusGeometry(1.1, 0.09, 4, 12, Math.PI), iron, Math.sin(a) * 1.75, 0.85, Math.cos(a) * 1.75); ar.rotation.y = a; e.add(ar); }
    e.add(mesh(cyl(0.05, 0.1, 1.0, 6), iron, 0, 11.0, 0));
    g.add(e);
    // Arc de Triomphe
    const arc = new THREE.Group(); arc.position.set(3.0, 0, 1.6); arc.rotation.y = -0.4;
    const stone = 0xe6dcc4;
    for (const sx of [-1, 1]) arc.add(mesh(box(0.8, 2.2, 1.0), stone, sx * 0.85, 1.1, 0));
    arc.add(mesh(box(2.5, 0.9, 1.0), stone, 0, 2.6, 0));
    arc.add(mesh(box(2.6, 0.18, 1.1), 0xd2c6aa, 0, 3.12, 0));
    g.add(arc);
    // little Seine-side benches / lamps
    for (const lx of [-3.6, 0.8]) { g.add(mesh(cyl(0.04, 0.05, 1.2, 6), 0x2b2b2b, lx, 0.6, 3.4)); g.add(mesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff1b5 }), lx, 1.25, 3.4)); }
    return { group: g, radius: 4.8, height: 11.5 };
  },

  // ---------- Cairo: Pyramids of Giza + Sphinx ----------
  cairo() {
    const g = new THREE.Group();
    plaza(g, 5.2, 0xe2c78f);
    const sand = 0xd9b26f;
    const pyr = (s, x, z) => { const p = mesh(cone(s, s * 1.25, 4), sand, x, s * 0.625, z); p.rotation.y = Math.PI / 4; g.add(p); const cap = mesh(cone(s * 0.18, s * 0.225, 4), 0xf3e2b0, x, s * 1.25 - s * 0.11, z); cap.rotation.y = Math.PI / 4; g.add(cap); };
    pyr(3.0, -1.4, -1.0); pyr(2.4, 2.6, -2.0); pyr(1.4, 3.6, 1.2);
    // Sphinx
    const sp = new THREE.Group(); sp.position.set(-1.6, 0, 3.0); sp.rotation.y = 0.3;
    sp.add(mesh(box(0.9, 0.7, 2.4), 0xc9a466, 0, 0.35, -0.2));
    sp.add(mesh(box(0.9, 1.0, 0.8), 0xc9a466, 0, 0.9, 0.9));
    sp.add(mesh(box(1.2, 0.8, 0.5), 0x3a6ea5, 0, 1.1, 0.75));
    for (const sx of [-0.3, 0.3]) sp.add(mesh(box(0.25, 0.25, 0.9), 0xc9a466, sx, 0.12, 1.3));
    g.add(sp);
    // camel-ish palms
    for (const [px, pz] of [[4.6, 3.0], [0.9, 4.2]]) { g.add(mesh(cyl(0.1, 0.14, 2.2, 6), 0x9a7a4e, px, 1.1, pz)); g.add(mesh(cone(0.9, 0.4, 7), 0x4c9a45, px, 2.3, pz)); }
    return { group: g, radius: 5.4, height: 3.8 };
  },

  // ---------- Rio: Maracanã stadium in the infield ----------
  rio() {
    const g = new THREE.Group();
    plaza(g, 4.2, 0x6db35c);
    const ring = mesh(new THREE.CylinderGeometry(3.6, 3.4, 1.4, 40, 1, true), 0xf2f2f2, 0, 0.7, 0); ring.material = mat(0xf2f2f2, { side: THREE.DoubleSide }); g.add(ring);
    g.add(mesh(new THREE.TorusGeometry(3.55, 0.25, 6, 40), 0xdedede, 0, 1.45, 0)); g.children[g.children.length - 1].rotation.x = Math.PI / 2;
    g.add(mesh(new THREE.TorusGeometry(2.7, 0.55, 4, 40), 0x3d6fb6, 0, 0.6, 0)); g.children[g.children.length - 1].rotation.x = Math.PI / 2; // stands
    g.add(mesh(box(3.0, 0.06, 1.9), 0x4caf50, 0, 0.12, 0)); // pitch
    g.add(mesh(box(0.05, 0.07, 1.9), 0xffffff, 0, 0.13, 0));
    return { group: g, radius: 4.2, height: 1.8 };
  },
};

// Background landmarks placed beyond the track (mountains etc.)
const BG = {
  bogota() { // Monserrate: green hill with the white sanctuary on top
    const g = new THREE.Group();
    g.add(mesh(cone(7, 9, 7), 0x4f7a45, 0, 4.5, 0));
    g.add(mesh(box(1.4, 0.9, 0.9), 0xf5f5f0, 0, 9.0, 0.3));
    g.add(mesh(box(0.45, 1.4, 0.45), 0xf5f5f0, 0.5, 9.4, 0.3));
    g.add(mesh(cone(0.35, 0.5, 4), 0xc9463d, 0.5, 10.35, 0.3));
    return g;
  },
  tokyo() { // Mount Fuji
    const g = new THREE.Group();
    g.add(mesh(cyl(1.2, 9, 7, 10), 0x5a6c96, 0, 3.5, 0));
    g.add(mesh(cyl(0.7, 2.6, 2.2, 10), mat(0xeef2ff, { emissive: 0x8090c0, emissiveIntensity: 0.6 }), 0, 6.0, 0));
    return g;
  },
  rio() { // Corcovado with Christ the Redeemer + Sugarloaf
    const g = new THREE.Group();
    g.add(mesh(cone(5.5, 8.5, 7), 0x3f7f3a, 0, 4.25, 0));
    const st = new THREE.Group(); st.position.set(0, 8.4, 0);
    st.add(mesh(box(0.5, 0.7, 0.5), 0xd8d4c8, 0, 0.35, 0));
    st.add(mesh(box(0.45, 1.8, 0.35), 0xf1efe8, 0, 1.6, 0));
    st.add(mesh(box(2.5, 0.3, 0.3), 0xf1efe8, 0, 2.2, 0));
    st.add(mesh(new THREE.SphereGeometry(0.22, 8, 6), 0xf1efe8, 0, 2.7, 0));
    g.add(st);
    const sl = mesh(new THREE.SphereGeometry(2.6, 12, 10), 0x5f7d4f, 7.5, 2.6, 2); sl.scale.set(0.8, 1.5, 0.8); g.add(sl);
    return g;
  },
};

export function landmarkFor(circuitId) { return B[circuitId] ? B[circuitId]() : null; }
export function backgroundFor(circuitId) { return BG[circuitId] ? BG[circuitId]() : null; }
