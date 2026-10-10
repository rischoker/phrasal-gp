// Podium ceremony: top-3 cars, trophy descending in a beam of light, fireworks and confetti
import * as THREE from 'three';
import * as A from './assets.js';
import { Particles, Confetti, Fireworks } from './fx.js';
import { sfx } from './audio.js';

const BEAM_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const BEAM_FRAG = `varying vec2 vUv; uniform float uI; uniform float uT; uniform vec3 uC;
void main(){ float edge = 1.0 - abs(vUv.x - 0.5) * 2.0; float a = pow(edge, 1.5) * (0.25 + 0.75 * vUv.y) * uI;
 a *= 0.85 + 0.15 * sin(vUv.y * 30.0 - uT * 6.0); gl_FragColor = vec4(uC, a * 0.75); }`;

export class PodiumView {
  constructor(renderer, platesEl) {
    this.r = renderer; this.platesEl = platesEl;
    const S = this.scene = new THREE.Scene();
    S.background = new THREE.Color(0x04050a);
    S.fog = new THREE.Fog(0x04050a, 22, 60);
    this.cam = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 300);
    this.time = 0;
    S.add(new THREE.HemisphereLight(0x8899ff, 0x110a10, 0.7));
    const key = new THREE.DirectionalLight(0xfff2dd, 1.6); key.position.set(-5, 12, 9); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); Object.assign(key.shadow.camera, { left: -10, right: 10, top: 10, bottom: -6 }); S.add(key);
    this.spots = [];
    for (const [x, c] of [[-7, 0xff3355], [7, 0x33aaff], [0, 0xffe7a0]]) {
      const sp = new THREE.SpotLight(c, 60, 40, 0.42, 0.6, 1.2); sp.position.set(x, 14, 6); sp.target.position.set(0, 0, 0);
      S.add(sp, sp.target); this.spots.push(sp);
    }
    const floor = new THREE.Mesh(new THREE.CircleGeometry(45, 64), new THREE.MeshStandardMaterial({ color: 0x0b0d16, roughness: 0.3, metalness: 0.5 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; S.add(floor);
    this.ps = new Particles(4000, 1); S.add(this.ps.points);
    this.ps.mat.uniforms.uScale.value = 26;
    this.confetti = new Confetti(600, 18, 14); S.add(this.confetti.mesh);
    this.fireworks = new Fireworks(this.ps, () => sfx.firework());
    this.plates = [];
  }

  async setup(results) {
    const S = this.scene;
    this.results = results;
    // LED wall with Grand Prix name
    const title = (results.circuit || 'GRAND PRIX').toUpperCase();
    const tex = A.textTexture(title, { w: 2048, h: 256, size: 120, font: 'Orbitron, sans-serif', draw: (x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#1a0004'); g.addColorStop(1, '#5a0010'); x.fillStyle = g; x.fillRect(0, 0, w, h); x.strokeStyle = '#e10600'; x.lineWidth = 16; x.strokeRect(8, 8, w - 16, h - 16); } });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(19, 2.35), new THREE.MeshBasicMaterial({ map: tex }));
    wall.position.set(0, 10.4, -9); S.add(wall);
    // podium blocks
    const heights = { 1: 1.7, 2: 1.15, 3: 0.75 };
    const xs = { 1: 0, 2: -3.6, 3: 3.6 };
    const colors = { 1: 0xd4af37, 2: 0xc0c7d0, 3: 0xcd7f32 };
    this.top = {};
    for (const pos of [1, 2, 3]) {
      const h = heights[pos];
      const numTex = A.textTexture(String(pos), { w: 256, h: 256, size: 200, font: 'Orbitron, sans-serif', color: '#111', bg: '#' + new THREE.Color(colors[pos]).getHexString() });
      const mats = [0, 0, 0, 0, 1, 0].map(i => i ? new THREE.MeshStandardMaterial({ map: numTex, roughness: 0.4, metalness: 0.3 }) : new THREE.MeshStandardMaterial({ color: colors[pos], roughness: 0.35, metalness: 0.6 }));
      const block = new THREE.Mesh(new THREE.BoxGeometry(3.2, h, 2.8), mats);
      block.position.set(xs[pos], h / 2, 0); block.castShadow = block.receiveShadow = true; S.add(block);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.08, 2.9), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      trim.position.set(xs[pos], h, 0); S.add(trim);
      this.top[pos] = new THREE.Vector3(xs[pos], h, 0);
    }
    // cars
    const rows = results.rows.slice(0, 3);
    this.cars = [];
    await Promise.all(rows.map(async row => {
      const m = await A.car(row.car || 'race', 2.5);
      const at = this.top[row.pos];
      if (!at) return;
      m.position.set(at.x, at.y + 6, at.z);
      m.rotation.y = 0.5 * (row.pos === 2 ? 1 : row.pos === 3 ? -1 : 0.3);
      S.add(m);
      const plate = document.createElement('div');
      plate.className = 'pplate p' + row.pos;
      plate.style.setProperty('--team', row.color);
      plate.innerHTML = '<span class="pp">P' + row.pos + '</span><span class="nm"></span><span class="tm"></span>';
      plate.querySelector('.nm').textContent = row.name;
      plate.querySelector('.tm').textContent = row.pos === 1 ? fmtTime(row.time) : row.gap;
      plate.style.opacity = '0';
      this.platesEl.appendChild(plate);
      this.cars.push({ m, row, at, plate, drop: 0 });
    }));
    // trophy + beam
    this.trophy = await A.trophy(2.3);
    const p1 = this.top[1];
    this.trophy.position.set(p1.x, 16, p1.z + 0.2);
    S.add(this.trophy);
    this.trophyLight = new THREE.PointLight(0xffe6a0, 0, 8, 1.5); this.trophy.add(this.trophyLight); this.trophyLight.position.y = 0.8;
    const beamGeo = new THREE.CylinderGeometry(1.1, 2.2, 22, 40, 1, true);
    this.beam = new THREE.Mesh(beamGeo, new THREE.ShaderMaterial({ vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { uI: { value: 0 }, uT: { value: 0 }, uC: { value: new THREE.Color(0xfff1c0) } } }));
    this.beam.position.set(p1.x, 11, p1.z + 0.2);
    S.add(this.beam);
    this.time = 0; this.landed = false; this.t0 = performance.now();
  }

  update(dt) {
    if (!this.t0) return;
    this.time = (performance.now() - this.t0) / 1000; // wall-clock timeline (stays in sync on slow PCs)
    const t = this.time;
    // cars drop in: P3 (0.3s), P2 (0.9s), P1 (1.6s)
    for (const c of this.cars || []) {
      const start = c.row.pos === 3 ? 0.3 : c.row.pos === 2 ? 0.9 : 1.6;
      const k = Math.min(1, Math.max(0, (t - start) / 0.7));
      const e = 1 - Math.pow(1 - k, 3);
      c.m.position.y = c.at.y + (1 - e) * 6 + (k === 1 ? Math.abs(Math.sin((t - start - 0.7) * 6)) * Math.max(0, 0.25 - (t - start - 0.7) * 0.3) : 0);
      if (k > 0 && !c.shown) { c.shown = true; sfx.lap(); }
      c.plate.style.opacity = k >= 1 ? '1' : '0';
      c.m.rotation.y += dt * (c.row.pos === 1 ? 0.25 : 0.12) * (k >= 1 ? 1 : 0);
    }
    // trophy descent (2.4s -> 7.4s)
    if (this.trophy) {
      const p1 = this.top[1];
      const restY = p1.y + 2.5;
      const k = Math.min(1, Math.max(0, (t - 2.4) / 5));
      const e = 1 - Math.pow(1 - k, 2.4);
      this.trophy.position.y = 16 + (restY - 16) * e + (k >= 1 ? Math.sin(t * 2) * 0.08 : 0);
      this.trophy.rotation.y += dt * (k >= 1 ? 1.1 : 2.2);
      const beamI = t < 2 ? t / 2 : k < 1 ? 1 : Math.max(0.35, 1 - (t - 7.4) * 0.3);
      this.beam.material.uniforms.uI.value = beamI;
      this.beam.material.uniforms.uT.value = t;
      this.trophyLight.intensity = 6 * beamI + 4;
      if (t > 2.4 && !this.trophySfx) { this.trophySfx = true; sfx.trophy(); }
      if (k > 0 && k < 1 && Math.random() < 0.6) {
        const tp = this.trophy.position;
        this.ps.emit(tp.x + (Math.random() - 0.5) * 1.6, tp.y + Math.random() * 1.5, tp.z + (Math.random() - 0.5) * 1.6, 0, -0.4, 0, '#fff1b0', 0.25, 1.2, 0, 0.5);
      }
      if (k >= 1 && !this.landed) {
        this.landed = true;
        const tp = this.trophy.position.clone(); tp.y += 0.7;
        this.ps.burst(tp, 160, ['#ffd700', '#fff6c8', '#ffffff'], 6, 0.35, 1.4, -3);
        sfx.cheer(5); sfx.horn();
        this.confetti.start();
        this.fireworks.start(new THREE.Vector3(0, 0.5, -6), 13, 10.5);
      }
    }
    // sweeping spotlights
    this.spots.forEach((s, i) => { s.target.position.set(Math.sin(t * (0.6 + i * 0.2) + i * 2) * 4, 0, Math.cos(t * 0.5 + i) * 2); });
    this.confetti.update(dt, t);
    this.fireworks.update(dt);
    this.ps.update(dt);
    // camera: start close on the winner, then pull back & orbit
    const k = Math.min(1, t / 8);
    const e = k * k * (3 - 2 * k);
    const ang = Math.sin(t * 0.12) * 0.25;
    const dist = 8 + e * 8.5;
    this.cam.position.set(Math.sin(ang) * dist, 3.2 + e * 2.2, Math.cos(ang) * dist);
    this.cam.lookAt(0, 3.0 + (1 - e) * 0.8, 0);
  }

  updatePlates(w, h) {
    const v = new THREE.Vector3();
    for (const c of this.cars || []) {
      v.set(c.at.x, c.at.y + (c.row.pos === 1 ? 5.3 : 2.0), c.at.z).project(this.cam);
      c.plate.style.transform = 'translate(' + ((v.x * 0.5 + 0.5) * w).toFixed(1) + 'px,' + ((-v.y * 0.5 + 0.5) * h).toFixed(1) + 'px) translate(-50%,-100%)';
    }
  }

  fit(w, h) { this.cam.aspect = w / h; this.cam.updateProjectionMatrix(); this.ps.mat.uniforms.uScale.value = 26 * (h / 1080) * this.r.getPixelRatio(); }
  dispose() { for (const c of this.cars || []) c.plate.remove(); this.fireworks.stop(); }
}

export function fmtTime(ms) {
  if (ms == null) return '—';
  const s = ms / 1000, m = Math.floor(s / 60);
  return (m ? m + ':' + String(Math.floor(s % 60)).padStart(2, '0') : Math.floor(s)) + '.' + String(Math.floor(ms % 1000)).padStart(3, '0');
}
