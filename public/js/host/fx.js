// Lightweight CPU particle system, confetti and fireworks
import * as THREE from 'three';

const VERT = `
attribute float size; attribute float alpha; attribute vec3 color;
varying float vA; varying vec3 vC;
uniform float uScale;
void main(){
  vA = alpha; vC = color;
  vec4 mv = modelViewMatrix * vec4(position,1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * uScale * (projectionMatrix[3][3] > 0.5 ? 1.0 : 30.0 / max(1.0, -mv.z));
}`;
const FRAG = `
varying float vA; varying vec3 vC;
void main(){
  vec2 d = gl_PointCoord - 0.5; float r = dot(d,d);
  if (r > 0.25) discard;
  float a = vA * smoothstep(0.25, 0.0, r);
  gl_FragColor = vec4(vC * (1.0 + a), a);
}`;

export class Particles {
  constructor(max = 1500, scale = 1) {
    this.max = max; this.n = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3);
    this.c = new Float32Array(max * 3); this.s = new Float32Array(max); this.a = new Float32Array(max);
    this.life = new Float32Array(max); this.age = new Float32Array(max); this.g = new Float32Array(max); this.drag = new Float32Array(max); this.s0 = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.c, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.s, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.a, 1).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uScale: { value: scale } } });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    this.geo = geo;
  }
  emit(x, y, z, vx, vy, vz, color, size, life, gravity = 0, drag = 0) {
    let i = this.n < this.max ? this.n++ : Math.floor(Math.random() * this.max);
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    const col = color instanceof THREE.Color ? color : new THREE.Color(color);
    this.c[i * 3] = col.r; this.c[i * 3 + 1] = col.g; this.c[i * 3 + 2] = col.b;
    this.s[i] = size; this.s0[i] = size; this.a[i] = 1; this.life[i] = life; this.age[i] = 0; this.g[i] = gravity; this.drag[i] = drag;
  }
  burst(pos, count, color, speed, size, life, gravity = -4, spread = 1) {
    for (let k = 0; k < count; k++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      const sp = speed * (0.6 + Math.random() * 0.4);
      const col = Array.isArray(color) ? color[k % color.length] : color;
      this.emit(pos.x, pos.y, pos.z, r * Math.cos(th) * sp * spread, u * sp, r * Math.sin(th) * sp * spread, col, size * (0.7 + Math.random() * 0.6), life * (0.7 + Math.random() * 0.6), gravity, 1.2);
    }
  }
  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        const j = --this.n;
        if (i !== j) {
          for (let k = 0; k < 3; k++) { this.p[i * 3 + k] = this.p[j * 3 + k]; this.v[i * 3 + k] = this.v[j * 3 + k]; this.c[i * 3 + k] = this.c[j * 3 + k]; }
          this.s[i] = this.s[j]; this.s0[i] = this.s0[j]; this.a[i] = this.a[j]; this.life[i] = this.life[j]; this.age[i] = this.age[j]; this.g[i] = this.g[j]; this.drag[i] = this.drag[j];
        }
        continue;
      }
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.v[i * 3] *= d; this.v[i * 3 + 1] = this.v[i * 3 + 1] * d + this.g[i] * dt; this.v[i * 3 + 2] *= d;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      const t = this.age[i] / this.life[i];
      this.a[i] = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9;
      this.s[i] = this.s0[i] * (1 - t * 0.5);
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    for (const k of ['position', 'color', 'size', 'alpha']) this.geo.attributes[k].needsUpdate = true;
  }
}

// Falling confetti (instanced quads)
export class Confetti {
  constructor(count = 500, area = 14, height = 14) {
    this.count = count; this.area = area; this.height = height;
    const geo = new THREE.PlaneGeometry(0.16, 0.26);
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, vertexColors: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    const cols = ['#e8002d', '#ffd700', '#27f4d2', '#3671c6', '#ff87bc', '#ffffff', '#ff8000', '#7cff4f'];
    this.d = [];
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      c.set(cols[i % cols.length]); this.mesh.setColorAt(i, c);
      this.d.push({ x: (Math.random() - 0.5) * area, y: Math.random() * height + height * 0.5, z: (Math.random() - 0.5) * area, rx: Math.random() * 6, ry: Math.random() * 6, vr: 2 + Math.random() * 5, vy: 1.2 + Math.random() * 1.6, ph: Math.random() * 6 });
    }
    this.active = false; this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.v = new THREE.Vector3(); this.one = new THREE.Vector3(1, 1, 1);
    this.mesh.visible = false;
  }
  start() { this.active = true; this.mesh.visible = true; for (const p of this.d) p.y = Math.random() * this.height + this.height * 0.3; }
  update(dt, t) {
    if (!this.active) return;
    for (let i = 0; i < this.count; i++) {
      const p = this.d[i];
      p.y -= p.vy * dt; p.rx += p.vr * dt; p.ry += p.vr * 0.7 * dt;
      if (p.y < -0.5) { p.y = this.height + Math.random() * 3; p.x = (Math.random() - 0.5) * this.area; p.z = (Math.random() - 0.5) * this.area; }
      this.v.set(p.x + Math.sin(t * 1.5 + p.ph) * 0.4, p.y, p.z + Math.cos(t * 1.2 + p.ph) * 0.3);
      this.q.setFromEuler(this.e.set(p.rx, p.ry, 0));
      this.m.compose(this.v, this.q, this.one);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// Fireworks driven by a Particles instance
export class Fireworks {
  constructor(particles, onBoom) { this.ps = particles; this.rockets = []; this.timer = 0; this.onBoom = onBoom; this.active = false; this.center = new THREE.Vector3(); this.radius = 10; this.height = 12; }
  start(center, radius = 10, height = 12) { this.active = true; this.center.copy(center); this.radius = radius; this.height = height; this.timer = 0; }
  stop() { this.active = false; }
  launch() {
    const a = Math.random() * Math.PI * 2, r = this.radius * (0.4 + Math.random() * 0.6);
    const pos = new THREE.Vector3(this.center.x + Math.cos(a) * r, this.center.y, this.center.z + Math.sin(a) * r * 0.5 - this.radius * 0.4);
    const pal = [['#ff3b3b', '#ffd23b'], ['#3bc9ff', '#ffffff'], ['#b13bff', '#ff7ae0'], ['#3bff7a', '#e8ff3b'], ['#ffd700', '#ff8000']][Math.floor(Math.random() * 5)];
    this.rockets.push({ pos, vel: new THREE.Vector3((Math.random() - 0.5) * 2, this.height * (0.9 + Math.random() * 0.4), (Math.random() - 0.5) * 1.5), t: 0, fuse: 0.9 + Math.random() * 0.35, pal });
  }
  update(dt) {
    if (this.active) { this.timer -= dt; if (this.timer <= 0) { this.launch(); this.timer = 0.35 + Math.random() * 0.6; } }
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.t += dt; r.vel.y -= 9 * dt; r.pos.addScaledVector(r.vel, dt);
      this.ps.emit(r.pos.x, r.pos.y, r.pos.z, (Math.random() - 0.5), -1, (Math.random() - 0.5), '#ffcc88', 0.35, 0.5, 0, 2);
      if (r.t >= r.fuse) {
        this.ps.burst(r.pos, 140, r.pal, 7.5, 0.55, 1.6, -3.5);
        this.ps.burst(r.pos, 30, '#ffffff', 3, 0.35, 0.8, -2);
        this.rockets.splice(i, 1);
        this.onBoom && this.onBoom();
      }
    }
  }
}
