// Race scene: isometric track built from road tiles, cars, effects, nameplates
import * as THREE from 'three';
import { buildTrack } from '../track.js';
import * as A from './assets.js';
import { Particles } from './fx.js';
import { sfx } from './audio.js';

export const TILE = 4;
const START_CELLS = 3; // start line after 3 straight cells
const ROAD_HALF = 1.55;

const THEMES = {
  harbour: { ground: 0x5f9e4f, infield: 0x6db35c, bg: 0x2c5f86, water: 'north', buildings: 'brick', trees: 0.35, sun: 0xfff1d6, hemi: [0xcfe8ff, 0x55704a], night: false },
  andes: { ground: 0x739f52, infield: 0x80b35d, bg: 0x6aa0c8, mountains: true, buildings: 'colorful', trees: 0.45, sun: 0xfff3dc, hemi: [0xd8ecff, 0x5a7048], night: false },
  riviera: { ground: 0xcdbb92, infield: 0x7fb05e, bg: 0x1f78a8, water: 'south', buildings: 'cream', trees: 0.3, palms: true, sun: 0xfff0c8, hemi: [0xe6f3ff, 0x8a7a58], night: false },
  night: { ground: 0x1c2333, infield: 0x22303a, bg: 0x070912, buildings: 'neon', trees: 0.15, sun: 0x8fa8ff, hemi: [0x34406a, 0x101018], night: true },
  park: { ground: 0x4c9845, infield: 0x58a94f, bg: 0x2f5f2c, buildings: 'brick', trees: 0.7, sun: 0xfff6e0, hemi: [0xd6eaff, 0x4d6a3f], night: false },
};

function rng(seed) { let s = 0; for (const ch of seed) s = (s * 31 + ch.charCodeAt(0)) >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

export class RaceView {
  constructor(renderer, circuit, platesEl) {
    this.r = renderer; this.circuit = circuit; this.platesEl = platesEl;
    this.theme = THEMES[circuit.theme] || THEMES.harbour;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.theme.bg);
    this.cam = new THREE.OrthographicCamera(-10, 10, 10, -10, -200, 400);
    this.cars = new Map();
    this.time = 0;
    this.insets = { l: 0, r: 0, t: 0, b: 0 };
    this.missiles = []; this.bolts = []; this.pops = [];
    this.lightsOn = 0;
  }

  async build() {
    const T = buildTrack(this.circuit.cmds);
    this.track = T;
    const S = this.scene;
    const th = this.theme;
    // lights
    const hemi = new THREE.HemisphereLight(th.hemi[0], th.hemi[1], th.night ? 1.5 : 1.6); S.add(hemi);
    const sun = new THREE.DirectionalLight(th.sun, th.night ? 0.9 : 2.6);
    sun.position.set(-30, 60, 25); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.03;
    S.add(sun); S.add(sun.target); this.sun = sun;
    // path (world units)
    const pts = T.pts.map(p => new THREE.Vector3(p[0] * TILE, 0.12, p[1] * TILE));
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
    this.curveLen = curve.getLength();
    const N = Math.max(600, Math.round(this.curveLen * 4));
    this.path = curve.getSpacedPoints(N); this.path.pop();
    this.pathN = this.path.length;
    // find start index: point nearest to ((START_CELLS-0.5) * TILE, 0)
    let best = 0, bd = 1e9; const sx = (START_CELLS - 0.5) * TILE;
    this.path.forEach((p, i) => { const d = (p.x - sx) ** 2 + p.z ** 2; if (d < bd) { bd = d; best = i; } });
    this.startIdx = best;
    // bounds
    const b = T.bounds;
    this.bounds = { minX: b.minX * TILE, maxX: b.maxX * TILE, minZ: b.minZ * TILE, maxZ: b.maxZ * TILE };
    const cx = (this.bounds.minX + this.bounds.maxX) / 2, cz = (this.bounds.minZ + this.bounds.maxZ) / 2;
    this.center = new THREE.Vector3(cx, 0, cz);
    const ext = Math.max(this.bounds.maxX - this.bounds.minX, this.bounds.maxZ - this.bounds.minZ) / 2 + 12;
    Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 220 });
    sun.position.set(cx - 30, 70, cz + 30); sun.target.position.set(cx, 0, cz);

    await Promise.all([this.buildGround(), this.buildTiles(), this.buildKerbs(), this.buildStart()]);
    await this.buildDecor();
    this.ps = new Particles(1800, 1);
    S.add(this.ps.points);
  }

  // ---------- environment ----------
  async buildGround() {
    const th = this.theme, S = this.scene;
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d');
    const base = new THREE.Color(th.ground);
    x.fillStyle = '#' + base.getHexString(); x.fillRect(0, 0, 256, 256);
    const R = rng('g' + this.circuit.id);
    for (let i = 0; i < 2200; i++) {
      const k = (R() - 0.5) * 0.12; const col = base.clone().offsetHSL(0, 0, k);
      x.fillStyle = '#' + col.getHexString(); x.fillRect(R() * 256, R() * 256, 2 + R() * 5, 2 + R() * 5);
    }
    const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(30, 30); tex.colorSpace = THREE.SRGBColorSpace;
    const g = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshLambertMaterial({ map: tex }));
    g.rotation.x = -Math.PI / 2; g.position.set(this.center.x, -0.02, this.center.z); g.receiveShadow = true;
    S.add(g);
    // infield patches (lighter grass) using inside test
    this.inside = (wx, wz) => {
      const P = this.path; let inside = false;
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
        const xi = P[i].x, zi = P[i].z, xj = P[j].x, zj = P[j].z;
        if (((zi > wz) !== (zj > wz)) && (wx < (xj - xi) * (wz - zi) / (zj - zi) + xi)) inside = !inside;
      }
      return inside;
    };
    const shape = new THREE.Shape(this.path.filter((_, i) => i % 3 === 0).map(p => new THREE.Vector2(p.x, -p.z)));
    const inf = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshLambertMaterial({ color: th.infield }));
    inf.rotation.x = -Math.PI / 2; inf.position.y = -0.01; inf.receiveShadow = true;
    S.add(inf);
    // water
    if (th.water) {
      const wc = document.createElement('canvas'); wc.width = wc.height = 128;
      const wx = wc.getContext('2d'); wx.fillStyle = '#1d6fa3'; wx.fillRect(0, 0, 128, 128);
      wx.strokeStyle = 'rgba(255,255,255,0.25)'; wx.lineWidth = 2;
      for (let i = 0; i < 14; i++) { const yy = Math.random() * 128, xx = Math.random() * 128; wx.beginPath(); wx.moveTo(xx, yy); wx.quadraticCurveTo(xx + 8, yy - 4, xx + 16, yy); wx.stroke(); }
      const wt = new THREE.CanvasTexture(wc); wt.wrapS = wt.wrapT = THREE.RepeatWrapping; wt.repeat.set(24, 10); wt.colorSpace = THREE.SRGBColorSpace;
      this.waterTex = wt;
      const w = new THREE.Mesh(new THREE.PlaneGeometry(400, 120), new THREE.MeshLambertMaterial({ map: wt }));
      w.rotation.x = -Math.PI / 2;
      const north = th.water === 'north';
      const edge = north ? this.bounds.minZ - TILE * 2.6 : this.bounds.maxZ + TILE * 2.2;
      w.position.set(this.center.x, 0.0, north ? edge - 60 : edge + 60);
      S.add(w);
      // quay wall
      const q = new THREE.Mesh(new THREE.BoxGeometry(400, 0.6, 0.8), new THREE.MeshLambertMaterial({ color: 0xbdb6a8 }));
      q.position.set(this.center.x, 0.0, edge); q.receiveShadow = true; S.add(q);
      this.waterEdge = { north, z: edge };
      // boats
      const R2 = rng('b' + this.circuit.id);
      for (let i = 0; i < 9; i++) {
        const boat = this.makeBoat(R2);
        boat.position.set(this.bounds.minX - 8 + R2() * (this.bounds.maxX - this.bounds.minX + 16), 0.05, north ? edge - 4 - R2() * 14 : edge + 4 + R2() * 14);
        boat.rotation.y = (R2() - 0.5) * 0.6 + (R2() < 0.5 ? 0 : Math.PI);
        boat.userData.bob = R2() * 6;
        S.add(boat); (this.boats = this.boats || []).push(boat);
      }
    }
  }

  makeBoat(R) {
    const g = new THREE.Group();
    const L = 3 + R() * 4;
    const hull = new THREE.Mesh(new THREE.BoxGeometry(L * 0.38, 0.5, L), new THREE.MeshLambertMaterial({ color: 0xffffff }));
    hull.position.y = 0.25; hull.castShadow = true; g.add(hull);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(L * 0.39, 0.1, L * 1.01), new THREE.MeshLambertMaterial({ color: [0x1f4e8c, 0xc0392b, 0x222222][Math.floor(R() * 3)] }));
    stripe.position.y = 0.2; g.add(stripe);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(L * 0.28, 0.45, L * 0.4), new THREE.MeshLambertMaterial({ color: 0xeef3f7 }));
    cab.position.set(0, 0.7, -L * 0.08); cab.castShadow = true; g.add(cab);
    const win = new THREE.Mesh(new THREE.BoxGeometry(L * 0.29, 0.14, L * 0.3), new THREE.MeshLambertMaterial({ color: 0x24394d }));
    win.position.set(0, 0.78, -L * 0.05); g.add(win);
    return g;
  }

  async buildTiles() {
    const names = { straight: 'road-straight', bend: 'road-bend', curve: 'road-curve' };
    const bars = { straight: 'road-straight-barrier', bend: 'road-bend-barrier', curve: 'road-curve-barrier' };
    const src = {};
    await Promise.all(Object.keys(names).map(async k => { src[k] = await A.road(names[k]); src['b' + k] = await A.road(bars[k]); }));
    // merge tiles of the same type into InstancedMeshes for performance
    const groups = {};
    for (const t of this.track.tiles) {
      for (const key of [t.type, 'b' + t.type]) {
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(t.x * TILE, 0, t.z * TILE),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot * Math.PI / 2),
          new THREE.Vector3(TILE, TILE, TILE));
        (groups[key] = groups[key] || []).push(m);
      }
    }
    for (const key in groups) {
      const mats = groups[key];
      src[key].updateMatrixWorld(true);
      src[key].traverse(o => {
        if (!o.isMesh) return;
        const im = new THREE.InstancedMesh(o.geometry, o.material, mats.length);
        const local = o.matrixWorld.clone();
        mats.forEach((m, i) => im.setMatrixAt(i, m.clone().multiply(local)));
        im.receiveShadow = true; im.castShadow = key.startsWith('b');
        this.scene.add(im);
      });
    }
  }

  async buildKerbs() {
    // red/white kerbs on both edges of every corner
    const P = this.path, kinds = this.track.kinds, n = this.track.pts.length;
    const items = [];
    const step = 0.55;
    let acc = 0, toggle = 0;
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      const seg = a.distanceTo(b); acc += seg;
      if (acc < step) continue; acc = 0; toggle ^= 1;
      // corner kerbs only: is the nearest raw track point part of a bend/curve?
      let raw = 0, rd = 1e9;
      for (let j = 0; j < n; j++) { const q = this.track.pts[j]; const d = (q[0] * TILE - a.x) ** 2 + (q[1] * TILE - a.z) ** 2; if (d < rd) { rd = d; raw = j; } }
      if (!kinds[raw]) continue;
      const dir = new THREE.Vector3().subVectors(b, a).normalize();
      const nrm = new THREE.Vector3(-dir.z, 0, dir.x);
      const yaw = Math.atan2(dir.x, dir.z);
      for (const side of [-1, 1]) items.push({ x: a.x + nrm.x * side * (ROAD_HALF + 0.12), z: a.z + nrm.z * side * (ROAD_HALF + 0.12), yaw, c: toggle });
    }
    const geo = new THREE.BoxGeometry(0.34, 0.07, step * 0.98);
    const im = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff }), items.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    const red = new THREE.Color(0xd81e1e), white = new THREE.Color(0xf4f4f4);
    items.forEach((it, i) => { m.compose(new THREE.Vector3(it.x, 0.1, it.z), q.setFromAxisAngle(up, it.yaw), one); im.setMatrixAt(i, m); im.setColorAt(i, it.c ? red : white); });
    im.receiveShadow = true;
    this.scene.add(im);
  }

  async buildStart() {
    const S = this.scene;
    const p = this.path[this.startIdx];
    // chequered line across the road (track runs along +X here)
    const c = document.createElement('canvas'); c.width = 64; c.height = 512;
    const x = c.getContext('2d');
    for (let i = 0; i < 2; i++) for (let j = 0; j < 16; j++) { x.fillStyle = (i + j) % 2 ? '#111' : '#fff'; x.fillRect(i * 32, j * 32, 32, 32); }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.5, ROAD_HALF * 2), new THREE.MeshLambertMaterial({ map: tex }));
    line.rotation.x = -Math.PI / 2; line.position.set(p.x, 0.095, p.z); S.add(line);
    // grid slots
    const slotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    for (let i = 0; i < 6; i++) {
      const pos = this.poseAt(-0.004 - i * 0.0095, i % 2 ? 0.6 : -0.6);
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 1.0), slotMat);
      bar.rotation.x = -Math.PI / 2; bar.position.set(pos.x + 1.0, 0.095, pos.z); S.add(bar);
    }
    // gantry with five start lights
    const g = new THREE.Group();
    const postMat = new THREE.MeshLambertMaterial({ color: 0x2b2f3a });
    const h = 3.2, w = ROAD_HALF * 2 + 1.4;
    for (const s of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, h, 0.3), postMat); post.position.set(0, h / 2, s * w / 2); post.castShadow = true; g.add(post); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, w + 0.3), postMat); beam.position.set(0, h, 0); beam.castShadow = true; g.add(beam);
    const ban = A.textTexture('PHRASAL GP', { w: 1024, h: 160, size: 110, bg: '#e10600', font: 'Orbitron, Titillium Web, sans-serif' });
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.7), new THREE.MeshBasicMaterial({ map: ban }));
    banner.position.set(0.26, h, 0); banner.rotation.y = Math.PI / 2; g.add(banner);
    const banner2 = banner.clone(); banner2.position.x = -0.26; banner2.rotation.y = -Math.PI / 2; g.add(banner2);
    this.startLights = [];
    for (let i = 0; i < 5; i++) {
      const pod = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.6, 0.38), new THREE.MeshLambertMaterial({ color: 0x111111 }));
      pod.position.set(0.3, h + 0.85, (i - 2) * 0.55); g.add(pod);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8), new THREE.MeshBasicMaterial({ color: 0x330000 }));
      bulb.position.set(0.48, h + 0.85, (i - 2) * 0.55); g.add(bulb);
      this.startLights.push(bulb);
    }
    g.position.set(p.x, 0, p.z);
    S.add(g);
  }

  setStartLights(n, green = false) {
    if (!this.startLights) return;
    this.startLights.forEach((b, i) => b.material.color.set(green ? 0x00ff66 : (i < n ? 0xff1a1a : 0x330000)));
  }

  async buildDecor() {
    const th = this.theme, S = this.scene;
    const R = rng('d' + this.circuit.id);
    const cells = this.track.cells;
    const b = this.track.bounds;
    const near = (x, z, r) => { for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (cells.has((x + dx) + ',' + (z + dz))) return true; return false; };
    const trees = [], buildings = [], stands = [], lamps = [];
    const M = 6;
    for (let x = Math.floor(b.minX) - M; x <= Math.ceil(b.maxX) + M; x++) {
      for (let z = Math.floor(b.minZ) - M + 1; z <= Math.ceil(b.maxZ) + M; z++) {
        if (cells.has(x + ',' + z)) continue;
        const wx = x * TILE, wz = z * TILE;
        if (this.waterEdge && (this.waterEdge.north ? wz < this.waterEdge.z + 1 : wz > this.waterEdge.z - 1)) continue;
        const inside = this.inside(wx, wz);
        const n1 = near(x, z, 1);
        // grandstands along the main straight (north side)
        if (z === -1 && x >= 0 && x <= START_CELLS + 2 && !near(x, z, 0)) { stands.push([wx, wz - 0.6]); continue; }
        if (n1) {
          if (!inside && R() < 0.22) lamps.push([wx + (R() - 0.5) * 2, wz + (R() - 0.5) * 2]);
          if (R() < th.trees * 0.5) trees.push([wx + (R() - 0.5) * 2.5, wz + (R() - 0.5) * 2.5, 0.8 + R() * 0.5]);
          continue;
        }
        if (inside) {
          const k = 1 + Math.floor(R() * 3);
          for (let i = 0; i < k; i++) if (R() < th.trees + 0.25) trees.push([wx + (R() - 0.5) * 3.4, wz + (R() - 0.5) * 3.4, 0.8 + R() * 0.6]);
        } else {
          const far = !near(x, z, 2);
          if (far && R() < 0.7) buildings.push([wx, wz, R]);
          else for (let i = 0; i < 2; i++) if (R() < th.trees + 0.3) trees.push([wx + (R() - 0.5) * 3.4, wz + (R() - 0.5) * 3.4, 0.9 + R() * 0.6]);
        }
      }
    }
    this.addTrees(trees, R);
    this.addBuildings(buildings, R);
    this.addStands(stands, R);
    await this.addLamps(lamps);
    if (th.mountains) this.addMountains(R);
    await this.addProps(R);
  }

  addTrees(list, R) {
    if (!list.length) return;
    const th = this.theme;
    const trunkGeo = new THREE.CylinderGeometry(0.12, 0.16, 1, 6);
    const crownGeo = th.palms ? new THREE.ConeGeometry(1.0, 0.5, 7) : new THREE.IcosahedronGeometry(0.9, 0);
    const pineGeo = new THREE.ConeGeometry(0.85, 2.0, 7);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: th.palms ? 0x9a7a4e : 0x6b4a2f }), list.length);
    const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), list.length);
    const pines = new THREE.InstancedMesh(pineGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    let np = 0, nc = 0;
    list.forEach(([x, z, s], i) => {
      const trunkH = th.palms ? 2.4 * s : 0.9 * s;
      m.compose(new THREE.Vector3(x, trunkH / 2, z), q.identity(), new THREE.Vector3(s, trunkH, s)); trunks.setMatrixAt(i, m);
      const greens = th.night ? [0x1d3b2a, 0x234a33] : [0x3f8f3a, 0x4ea845, 0x2f7a35, 0x5bb04c, 0x7fbf4a];
      c.set(greens[Math.floor(R() * greens.length)]);
      if (!th.palms && R() < 0.35) {
        m.compose(new THREE.Vector3(x, trunkH + 0.9 * s, z), q.identity(), new THREE.Vector3(s, s, s)); pines.setMatrixAt(np, m); pines.setColorAt(np, c); np++;
      } else {
        q.setFromEuler(new THREE.Euler(0, R() * 6, 0));
        m.compose(new THREE.Vector3(x, trunkH + (th.palms ? 0.1 : 0.55 * s), z), q, new THREE.Vector3(s * (th.palms ? 1.3 : 1), s * (th.palms ? 0.6 : 1), s)); crowns.setMatrixAt(nc, m); crowns.setColorAt(nc, c); nc++;
      }
    });
    trunks.castShadow = crowns.castShadow = pines.castShadow = true;
    crowns.count = nc; pines.count = np;
    this.scene.add(trunks, crowns, pines);
  }

  addBuildings(list, R) {
    if (!list.length) return;
    const th = this.theme;
    // window texture
    const c = document.createElement('canvas'); c.width = 64; c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = th.night ? '#000000' : '#ffffff'; x.fillRect(0, 0, 64, 128);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 8; j++) {
      const lit = th.night ? Math.random() < 0.55 : false;
      x.fillStyle = th.night ? (lit ? ['#ffe08a', '#7ef9ff', '#ff7ad9', '#fff4c4'][Math.floor(Math.random() * 4)] : '#0a0d16') : '#5d7286';
      x.fillRect(6 + i * 15, 8 + j * 15, 9, 9);
    }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const mat = th.night ? new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.0 })
      : new THREE.MeshLambertMaterial({ color: 0xffffff, map: tex });
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, list.length);
    const roof = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.2, 1), new THREE.MeshLambertMaterial({ color: th.night ? 0x0b0f1a : 0x5a5a62 }), list.length);
    const palettes = {
      brick: [0xb5543f, 0x9c4a3a, 0xc9a27a, 0x8c8f99, 0xd9cdb8],
      colorful: [0xf2c14e, 0xe76f51, 0x2a9d8f, 0xf4a261, 0x9b5de5, 0xfefae0],
      cream: [0xf4ead5, 0xe9d8b4, 0xf7e1d7, 0xdbe7e4, 0xfff4e0],
      neon: [0x3a4166, 0x2c3358, 0x46507a, 0x343b62],
    };
    const pal = palettes[th.buildings] || palettes.brick;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    list.forEach(([bx, bz], i) => {
      const w = 2.4 + R() * 1.2, d = 2.4 + R() * 1.2, h = th.buildings === 'neon' ? 3 + R() * 9 : 1.8 + R() * 4.5;
      m.compose(new THREE.Vector3(bx, h / 2, bz), q.identity(), new THREE.Vector3(w, h, d)); im.setMatrixAt(i, m);
      col.set(pal[Math.floor(R() * pal.length)]); im.setColorAt(i, col);
      m.compose(new THREE.Vector3(bx, h + 0.1, bz), q.identity(), new THREE.Vector3(w + 0.15, 1, d + 0.15)); roof.setMatrixAt(i, m);
    });
    im.castShadow = im.receiveShadow = true; roof.castShadow = true;
    this.scene.add(im, roof);
    if (th.night) {
      // neon signs (glowing sprites)
      const glowTex = this.glowTexture();
      const colors = [0xff2fd1, 0x2ff3ff, 0xffe02f, 0x7d5cff];
      list.forEach(([bx, bz], i) => {
        if (R() > 0.45) return;
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: colors[i % 4], transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        s.scale.set(4, 4, 1); s.position.set(bx, 2 + R() * 4, bz + 1.4); this.scene.add(s);
      });
    }
  }

  glowTexture() {
    if (this._glow) return this._glow;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    this._glow = new THREE.CanvasTexture(c); return this._glow;
  }

  addStands(list, R) {
    if (!list.length) return;
    const S = this.scene;
    const standMat = new THREE.MeshLambertMaterial({ color: 0xb8bec9 });
    const roofMat = new THREE.MeshLambertMaterial({ color: 0xe10600 });
    const crowd = [];
    for (const [x, z] of list) {
      for (let r = 0; r < 3; r++) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(TILE, 0.45, 0.8), standMat);
        step.position.set(x, 0.22 + r * 0.45, z - r * 0.8 + 0.4); step.castShadow = step.receiveShadow = true; S.add(step);
        for (let k = 0; k < 9; k++) crowd.push([x - TILE / 2 + 0.25 + k * 0.44 + (R() - 0.5) * 0.1, 0.62 + r * 0.45, z - r * 0.8 + 0.4]);
      }
      const roof = new THREE.Mesh(new THREE.BoxGeometry(TILE, 0.12, 2.8), roofMat);
      roof.position.set(x, 2.9, z - 0.8); roof.castShadow = true; S.add(roof);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.9, 0.12), standMat); post.position.set(x - TILE / 2 + 0.1, 1.45, z - 2.1); S.add(post);
    }
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 0.32, 0.22), new THREE.MeshLambertMaterial({ color: 0xffffff }), crowd.length);
    const m = new THREE.Matrix4(), c = new THREE.Color();
    const cols = [0xe8002d, 0xffd400, 0x3671c6, 0xffffff, 0x27f4d2, 0xff8000, 0x229971, 0xff87bc, 0x222222];
    crowd.forEach((p, i) => { m.makeTranslation(p[0], p[1], p[2]); im.setMatrixAt(i, m); im.setColorAt(i, c.set(cols[Math.floor(R() * cols.length)])); });
    this.crowd = { im, base: crowd };
    S.add(im);
  }

  async addLamps(list) {
    if (!list.length) return;
    const src = await A.road('light-square');
    const glow = this.theme.night ? this.glowTexture() : null;
    for (const [x, z] of list.slice(0, 40)) {
      const l = src.clone(); l.scale.setScalar(TILE * 0.9); l.position.set(x, 0, z); l.rotation.y = Math.random() * 6; this.scene.add(l);
      if (glow) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffd98a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); s.scale.set(3, 3, 1); s.position.set(x, 2.1, z); this.scene.add(s); }
    }
  }

  addMountains(R) {
    const mat = new THREE.MeshLambertMaterial({ color: 0x5c7a5a, flatShading: true });
    const snow = new THREE.MeshLambertMaterial({ color: 0xf2f4f7, flatShading: true });
    for (let i = 0; i < 9; i++) {
      const h = 14 + R() * 14, r = 12 + R() * 10;
      const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 6), mat);
      const x = this.bounds.minX - 20 + i * ((this.bounds.maxX - this.bounds.minX + 40) / 8);
      m.position.set(x, h / 2 - 1, this.bounds.minZ - 30 - R() * 10); m.rotation.y = R() * 3; this.scene.add(m);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.3, h * 0.3, 6), snow);
      cap.position.set(x, h - 1 - h * 0.15, m.position.z); cap.rotation.y = m.rotation.y; this.scene.add(cap);
    }
  }

  async addProps(R) {
    // sponsor boards along the straight + cones near corners
    const words = ['GET UP', 'TAKE OFF', 'LOOK OUT', 'GIVE UP', 'SET OFF', 'CARRY ON', 'SPEED UP', 'TURN UP'];
    const cols = ['#e10600', '#111827', '#0a7cff', '#ffcc00'];
    let k = 0;
    for (const t of this.track.tiles) {
      if (t.type !== 'straight' || R() > 0.45) continue;
      const side = t.h % 2 === 0 ? (t.z <= 0 ? -1 : 1) : (t.x <= 0 ? -1 : 1);
      const tex = A.textTexture(words[k % words.length], { w: 512, h: 96, size: 64, bg: cols[k % cols.length], color: cols[k % cols.length] === '#ffcc00' ? '#111' : '#fff' });
      k++;
      const board = new THREE.Mesh(new THREE.BoxGeometry(TILE * 0.85, 0.5, 0.08), [0, 0, 0, 0, 1, 1].map(i => new THREE.MeshLambertMaterial(i ? { map: tex } : { color: 0x222222 })));
      board.castShadow = true;
      if (t.h % 2 === 0) { board.position.set(t.x * TILE, 0.35, t.z * TILE + side * (TILE / 2 + 0.25)); }
      else { board.position.set(t.x * TILE + side * (TILE / 2 + 0.25), 0.35, t.z * TILE); board.rotation.y = Math.PI / 2; }
      this.scene.add(board);
    }
  }

  // ---------- path helpers ----------
  // dist in laps (0 = start line), lane = lateral offset in world units
  poseAt(dist, lane = 0, out = {}) {
    const u = ((dist % 1) + 1) % 1;
    const f = this.startIdx + u * this.pathN;
    const i0 = Math.floor(f) % this.pathN, i1 = (i0 + 1) % this.pathN, t = f - Math.floor(f);
    const a = this.path[i0], b = this.path[i1];
    const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
    const n2 = this.path[(i0 + 3) % this.pathN], p2 = this.path[(i0 - 2 + this.pathN) % this.pathN];
    let dx = n2.x - p2.x, dz = n2.z - p2.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    out.x = x - dz * lane; out.z = z + dx * lane; out.yaw = Math.atan2(dx, dz); out.dx = dx; out.dz = dz;
    return out;
  }

  // ---------- cars ----------
  async setCars(players, grid) {
    const keep = new Set(players.map(p => p.id));
    for (const [id, c] of this.cars) if (!keep.has(id)) { this.scene.remove(c.group); c.plate.remove(); this.cars.delete(id); }
    await Promise.all(players.map(async p => {
      let c = this.cars.get(p.id);
      if (c && c.carId === p.car) { c.name = p.name; c.color = p.color; c.plate.querySelector('.nm').textContent = p.name; return; }
      if (c) { this.scene.remove(c.group); c.plate.remove(); }
      const model = await A.car(p.car || 'race', 1.9);
      const group = new THREE.Group();
      group.add(model);
      // team colour underglow disc
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 1.0, 24), new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: 0.55, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.11; group.add(ring);
      const shield = new THREE.Mesh(new THREE.SphereGeometry(1.4, 20, 14), new THREE.MeshBasicMaterial({ color: 0x5ad8ff, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending }));
      shield.position.y = 0.5; shield.visible = false; group.add(shield);
      this.scene.add(group);
      const plate = document.createElement('div');
      plate.className = 'plate';
      plate.innerHTML = '<b class="pos">-</b><span class="nm"></span><i class="fx"></i>';
      plate.style.setProperty('--team', p.color);
      plate.querySelector('.nm').textContent = p.name;
      this.platesEl.appendChild(plate);
      const gi = grid ? grid.indexOf(p.id) : 0;
      const baseLane = gi % 2 ? 0.6 : -0.6;
      c = { id: p.id, carId: p.car, name: p.name, color: p.color, group, model, ring, shield, plate, dist: -0.004 - gi * 0.0095, disp: -0.004 - gi * 0.0095, speed: 0, flags: 0, tickAt: performance.now(), lane: baseLane, laneT: baseLane, baseLane, spin: 0, scale: 1, pos: 0 };
      this.cars.set(p.id, c);
      this.placeCar(c, 0);
    }));
  }

  onTick(msg) {
    const t = performance.now();
    for (const [id, dist, speed, flags] of msg.c) {
      const c = this.cars.get(id); if (!c) continue;
      c.dist = dist; c.speed = speed; c.tickAt = t;
      if ((flags & 32) && !(c.flags & 32)) sfx.shield();
      c.flags = flags;
    }
  }

  setPositions(rows) {
    for (const r of rows) {
      const c = this.cars.get(r.id); if (!c) continue;
      c.pos = r.pos;
      c.plate.querySelector('.pos').textContent = r.pos;
      c.plate.classList.toggle('leader', r.pos === 1);
      c.plate.classList.toggle('power', !!r.power);
      c.plate.classList.toggle('off', !r.connected);
      const fx = c.plate.querySelector('.fx');
      fx.textContent = r.finished ? '🏁' : r.power ? '⚡' : r.streak >= 3 ? '🔥' + r.streak : '';
    }
  }

  answerPop(id, correct) {
    const c = this.cars.get(id); if (!c) return;
    const el = document.createElement('div');
    el.className = 'pop ' + (correct ? 'ok' : 'bad');
    el.textContent = correct ? '+' : '−';
    this.platesEl.appendChild(el);
    this.pops.push({ el, c, t: 0 });
    const p = c.group.position;
    if (correct) this.ps.burst(new THREE.Vector3(p.x, 0.6, p.z), 10, ['#46ff9a', '#ffffff'], 3, 0.25, 0.5, -2);
    else this.ps.burst(new THREE.Vector3(p.x, 0.4, p.z), 8, ['#777777', '#aaaaaa'], 1.5, 0.35, 0.8, 1);
  }

  powerFx(ev) {
    const by = this.cars.get(ev.id);
    if (ev.power === 'turbo') { sfx.whoosh(); }
    if (ev.power === 'shield') { sfx.shield(); }
    if (ev.power === 'shrink') {
      sfx.shrink();
      for (const id of ev.targets) {
        const c = this.cars.get(id); if (!c) continue;
        this.lightning(c.group.position);
      }
    }
    if (ev.power === 'missile' && by) {
      const target = this.cars.get(ev.targets[0] || ev.blocked[0]);
      if (target) this.launchMissile(by, target, ev.blocked.length > 0);
    }
    for (const id of ev.blocked) { const c = this.cars.get(id); if (c) this.ps.burst(new THREE.Vector3(c.group.position.x, 0.8, c.group.position.z), 40, ['#5ad8ff', '#ffffff'], 5, 0.4, 0.7, -1); }
  }

  lightning(pos) {
    const pts = []; let x = pos.x + (Math.random() - 0.5) * 2, z = pos.z;
    for (let y = 14; y >= 0.4; y -= 1.2) { pts.push(new THREE.Vector3(x, y, z)); x += (Math.random() - 0.5) * 1.2; z += (Math.random() - 0.5) * 0.6; }
    pts.push(new THREE.Vector3(pos.x, 0.4, pos.z));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xfff6a0, transparent: true }));
    this.scene.add(line);
    this.bolts.push({ line, t: 0 });
    this.ps.burst(new THREE.Vector3(pos.x, 0.5, pos.z), 30, ['#fff6a0', '#ffffff', '#b8a2ff'], 6, 0.4, 0.5, -3);
  }

  launchMissile(from, to, blocked) {
    sfx.whoosh();
    const m = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.8, 8), new THREE.MeshLambertMaterial({ color: 0xff2a2a }));
    body.rotation.x = Math.PI / 2; m.add(body);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 8), new THREE.MeshLambertMaterial({ color: 0xffffff }));
    tip.rotation.x = Math.PI / 2; tip.position.z = 0.55; m.add(tip);
    this.scene.add(m);
    this.missiles.push({ m, from: from.group.position.clone(), to, t: 0, dur: 1.1, blocked });
  }

  placeCar(c, dt) {
    const pose = this.poseAt(c.disp, c.lane, this._pose || (this._pose = {}));
    const g = c.group;
    g.position.set(pose.x, 0.08, pose.z);
    const targetYaw = pose.yaw;
    g.rotation.y = targetYaw + c.spin;
  }

  update(dt, raceRunning) {
    this.time += dt;
    const now = performance.now();
    const list = [...this.cars.values()];
    for (const c of list) {
      const pred = c.dist + c.speed * Math.min(0.6, (now - c.tickAt) / 1000);
      if (Math.abs(pred - c.disp) > 0.08) c.disp = pred; else c.disp += (pred - c.disp) * Math.min(1, dt * 6);
    }
    // lane logic: avoid overlapping a car just ahead
    const L = this.curveLen;
    for (const c of list) {
      let target = c.baseLane;
      for (const o of list) {
        if (o === c) continue;
        const gap = (o.disp - c.disp) * L;
        if (gap > -0.6 && gap < 2.6 && Math.abs(o.lane - target) < 0.9) target = o.lane > 0 ? -0.7 : 0.7;
      }
      c.laneT = target;
      c.lane += (c.laneT - c.lane) * Math.min(1, dt * 2.2);
    }
    for (const c of list) {
      const f = c.flags;
      const spinning = f & 16;
      if (spinning) c.spin += dt * 14; else c.spin = c.spin % (Math.PI * 2) * Math.max(0, 1 - dt * 8);
      const targetScale = f & 8 ? 0.5 : 1;
      c.scale += (targetScale - c.scale) * Math.min(1, dt * 6);
      c.model.scale.setScalar(c.scale);
      c.shield.visible = !!(f & 32);
      if (c.shield.visible) c.shield.material.opacity = 0.2 + Math.sin(this.time * 6) * 0.08;
      this.placeCar(c, dt);
      // wheels
      const v = c.speed * L; // units per second
      for (const w of c.model.userData.wheels) w.rotation.x += v * dt * 2.4;
      // exhaust / boost particles
      const p = c.group.position;
      const back = this._pose;
      if (raceRunning && v > 0.5) {
        const yaw = c.group.rotation.y, bx = p.x - Math.sin(yaw) * 0.95 * c.scale, bz = p.z - Math.cos(yaw) * 0.95 * c.scale;
        if (f & 4) { for (let k = 0; k < 3; k++) this.ps.emit(bx, 0.35, bz, (Math.random() - 0.5) * 1.5 - Math.sin(yaw) * 3, Math.random() * 1.2, (Math.random() - 0.5) * 1.5 - Math.cos(yaw) * 3, k ? '#ff9a1a' : '#ffe14a', 0.6, 0.35, 0, 1); }
        else if (f & 1) { if (Math.random() < 0.7) this.ps.emit(bx, 0.3, bz, -Math.sin(yaw) * 2, 0.4, -Math.cos(yaw) * 2, '#4fd8ff', 0.4, 0.3, 0, 1); }
        else if (f & 2) { if (Math.random() < 0.3) this.ps.emit(bx, 0.4, bz, 0, 1.2, 0, '#8a8a8a', 0.6, 0.7, 0, 1); }
        if (f & 8 && Math.random() < 0.2) this.ps.emit(p.x, 1.2, p.z, 0, 0.5, 0, '#b8a2ff', 0.35, 0.6);
      }
    }
    // missiles
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const M = this.missiles[i];
      M.t += dt;
      const k = Math.min(1, M.t / M.dur);
      const to = M.to.group.position;
      const x = M.from.x + (to.x - M.from.x) * k, z = M.from.z + (to.z - M.from.z) * k, y = 0.6 + Math.sin(k * Math.PI) * 5;
      const prev = M.m.position.clone();
      M.m.position.set(x, y, z);
      M.m.lookAt(2 * x - prev.x, 2 * y - prev.y, 2 * z - prev.z);
      this.ps.emit(x, y, z, 0, 0.5, 0, '#ffb347', 0.45, 0.4, 0, 2);
      if (k >= 1) {
        this.scene.remove(M.m); this.missiles.splice(i, 1);
        const pos = new THREE.Vector3(to.x, 0.6, to.z);
        if (M.blocked) { sfx.shield(); }
        else { sfx.boom(); this.ps.burst(pos, 90, ['#ff4d1a', '#ffd21a', '#ffffff', '#555555'], 7, 0.6, 0.9, -5); }
      }
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const B = this.bolts[i]; B.t += dt;
      B.line.material.opacity = Math.max(0, 1 - B.t / 0.5) * (Math.random() < 0.5 ? 1 : 0.4);
      if (B.t > 0.5) { this.scene.remove(B.line); B.line.geometry.dispose(); this.bolts.splice(i, 1); }
    }
    if (this.waterTex) this.waterTex.offset.x = this.time * 0.01;
    if (this.boats) for (const b of this.boats) b.position.y = 0.05 + Math.sin(this.time * 1.4 + b.userData.bob) * 0.06;
    if (this.crowd && raceRunning) {
      const m = new THREE.Matrix4(); const im = this.crowd.im;
      if (Math.floor(this.time * 10) % 2 === 0) {
        this.crowd.base.forEach((p, i) => { m.makeTranslation(p[0], p[1] + Math.max(0, Math.sin(this.time * 9 + i)) * 0.12, p[2]); im.setMatrixAt(i, m); });
        im.instanceMatrix.needsUpdate = true;
      }
    }
    this.ps.update(dt);
  }

  // place DOM nameplates (call after render sizing)
  updatePlates(w, h) {
    const v = new THREE.Vector3();
    for (const c of this.cars.values()) {
      v.set(c.group.position.x, 1.6 * c.scale + 0.4, c.group.position.z).project(this.cam);
      const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      c.plate.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) translate(-50%,-100%)';
      c.sx = x; c.sy = y;
    }
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const P = this.pops[i]; P.t += 1 / 60;
      P.el.style.transform = 'translate(' + (P.c.sx + 34) + 'px,' + (P.c.sy - 22 - P.t * 40) + 'px)';
      P.el.style.opacity = String(Math.max(0, 1 - P.t / 0.9));
      if (P.t > 0.9) { P.el.remove(); this.pops.splice(i, 1); }
    }
  }

  // Orthographic isometric camera fitted to the track inside the free screen area
  fit(w, h, ins) {
    this.insets = ins;
    const cam = this.cam;
    const elev = THREE.MathUtils.degToRad(54), az = THREE.MathUtils.degToRad(-8);
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(elev), Math.sin(elev), Math.cos(az) * Math.cos(elev));
    cam.position.copy(this.center).addScaledVector(dir, 150);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.center);
    cam.updateMatrixWorld();
    const inv = cam.matrixWorldInverse;
    const B = this.bounds, m = 1.5;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const X of [B.minX - m, B.maxX + m]) for (const Z of [B.minZ - m, B.maxZ + m]) for (const Y of [0, 3.5]) {
      const v = new THREE.Vector3(X, Y, Z).applyMatrix4(inv);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
    const aw = Math.max(100, w - ins.l - ins.r), ah = Math.max(100, h - ins.t - ins.b);
    const s = Math.min(aw / (x1 - x0), ah / (y1 - y0));
    const left = x0 - (ins.l + (aw - (x1 - x0) * s) / 2) / s;
    const top = y1 + (ins.t + (ah - (y1 - y0) * s) / 2) / s;
    cam.left = left; cam.right = left + w / s; cam.top = top; cam.bottom = top - h / s;
    cam.near = -50; cam.far = 400;
    cam.updateProjectionMatrix();
    this.pxPerUnit = s;
    this.ps.mat.uniforms.uScale.value = s * (this.r.getPixelRatio ? this.r.getPixelRatio() : 1);
  }

  dispose() {
    for (const c of this.cars.values()) c.plate.remove();
    for (const p of this.pops) p.el.remove();
    this.scene.traverse(o => { if (o.geometry && !o.isInstancedMesh) o.geometry.dispose(); });
  }
}
