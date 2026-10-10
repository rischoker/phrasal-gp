// Lobby "garage": 6 turntables showing each driver's chosen car
import * as THREE from 'three';
import * as A from './assets.js';

export class LobbyView {
  constructor(renderer, platesEl) {
    this.r = renderer; this.platesEl = platesEl;
    const S = this.scene = new THREE.Scene();
    S.background = new THREE.Color(0x05060b);
    S.fog = new THREE.Fog(0x05060b, 18, 42);
    this.cam = new THREE.PerspectiveCamera(32, 16 / 9, 0.1, 200);
    this.time = 0;
    S.add(new THREE.HemisphereLight(0x9fb4ff, 0x1a1020, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(4, 10, 8); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); Object.assign(key.shadow.camera, { left: -14, right: 14, top: 8, bottom: -8 });
    S.add(key);
    // glossy floor
    const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 48), new THREE.MeshStandardMaterial({ color: 0x0d0f18, roughness: 0.35, metalness: 0.4 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; S.add(floor);
    // floor grid lines
    const grid = new THREE.GridHelper(60, 30, 0x2a2f4a, 0x161a2c); grid.position.y = 0.005; S.add(grid);
    // LED wall
    this.wall = new THREE.Mesh(new THREE.PlaneGeometry(18, 2.25), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.wall.position.set(0, 3.9, -9); S.add(this.wall);
    this.setTitle('PHRASAL VERBS GRAND PRIX');
    this.slots = [];
    for (let i = 0; i < 6; i++) {
      const x = (i - 2.5) * 3.1, z = -Math.abs(i - 2.5) * 0.5;
      const g = new THREE.Group(); g.position.set(x, 0, z); S.add(g);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.6, 0.3, 40), new THREE.MeshStandardMaterial({ color: 0x1b1f2e, roughness: 0.4, metalness: 0.6 }));
      base.position.y = 0.15; base.receiveShadow = true; base.castShadow = true; g.add(base);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.05, 8, 64), new THREE.MeshBasicMaterial({ color: 0x333a55 }));
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.31; g.add(ring);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.5, 6, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0x333a55, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      beam.position.y = 3.3; g.add(beam);
      const spin = new THREE.Group(); spin.position.y = 0.3; g.add(spin);
      const holo = new THREE.Mesh(new THREE.TorusKnotGeometry(0.35, 0.08, 64, 8), new THREE.MeshBasicMaterial({ color: 0x3a4266, wireframe: true }));
      holo.position.y = 1.2; g.add(holo);
      const plate = document.createElement('div');
      plate.className = 'lplate empty';
      plate.innerHTML = '<span class="num">' + (i + 1) + '</span><span class="nm">WAITING…</span><span class="car"></span>';
      platesEl.appendChild(plate);
      this.slots.push({ g, base, ring, beam, spin, holo, plate, carId: null, playerId: null, model: null });
    }
  }

  setTitle(text) {
    if (this.title === text) return; this.title = text;
    const old = this.wall.material.map;
    this.wall.material.map = A.textTexture(text.toUpperCase(), { w: 2048, h: 256, size: 120, font: 'Orbitron, sans-serif', color: '#ffffff', draw: (x, w, h) => { const g = x.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#12000a'); g.addColorStop(0.5, '#b80500'); g.addColorStop(1, '#12000a'); x.fillStyle = g; x.fillRect(0, 0, w, h); x.fillStyle = 'rgba(255,255,255,.12)'; for (let i = 0; i < w; i += 8) x.fillRect(i, 0, 1, h); } });
    this.wall.material.needsUpdate = true;
    if (old) old.dispose();
  }

  async setPlayers(players, cars) {
    const names = Object.fromEntries((cars || []).map(c => [c.id, c.name]));
    for (let i = 0; i < 6; i++) {
      const s = this.slots[i], p = players[i];
      s.plate.classList.toggle('empty', !p);
      s.plate.classList.toggle('off', !!p && !p.connected);
      s.plate.querySelector('.nm').textContent = p ? p.name : 'WAITING…';
      s.plate.querySelector('.car').textContent = p ? (p.car ? names[p.car] || p.car : 'choosing car…') : '';
      s.plate.style.setProperty('--team', p ? p.color : '#3a4266');
      s.plate.dataset.id = p ? p.id : '';
      const col = new THREE.Color(p ? p.color : 0x333a55);
      s.ring.material.color.copy(col); s.beam.material.color.copy(col);
      s.beam.material.opacity = p ? 0.16 : 0.05;
      s.holo.visible = !p || !p.car;
      s.holo.material.color.copy(p ? col : new THREE.Color(0x3a4266));
      const want = p && p.car ? p.car : null;
      if (want !== s.carId) {
        s.carId = want;
        if (s.model) { s.spin.remove(s.model); s.model = null; }
        if (want) {
          const m = await A.car(want, 2.6);
          if (s.carId !== want) continue;
          s.model = m; s.spin.add(m); s.drop = 1;
        }
      }
    }
  }

  update(dt) {
    this.time += dt;
    this.slots.forEach((s, i) => {
      s.spin.rotation.y += dt * 0.6;
      s.holo.rotation.y += dt; s.holo.rotation.x += dt * 0.5;
      if (s.drop > 0) { s.drop = Math.max(0, s.drop - dt * 2.5); s.spin.position.y = 0.3 + s.drop * s.drop * 2.5; }
    });
    const t = this.time * 0.15;
    this.cam.position.set(2.0 + Math.sin(t) * 1.2, 5.6, 21.5);
    this.cam.lookAt(2.0, 1.3, -1);
  }

  updatePlates(w, h) {
    const v = new THREE.Vector3();
    for (const s of this.slots) {
      v.set(s.g.position.x, -0.1, s.g.position.z + 1.6).project(this.cam);
      s.plate.style.transform = 'translate(' + ((v.x * 0.5 + 0.5) * w).toFixed(1) + 'px,' + ((-v.y * 0.5 + 0.5) * h).toFixed(1) + 'px) translate(-50%,0)';
    }
  }

  fit(w, h) { this.cam.aspect = w / h; this.cam.fov = w / h < 1.5 ? 42 : 34; this.cam.updateProjectionMatrix(); }
  dispose() { for (const s of this.slots) s.plate.remove(); }
}
