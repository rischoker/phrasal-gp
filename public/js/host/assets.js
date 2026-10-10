// GLB loading + caching helpers
import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = new Map();

export function loadGLB(url) {
  if (!cache.has(url)) {
    cache.set(url, new Promise((res, rej) => loader.load(url, g => {
      g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      res(g.scene);
    }, undefined, err => { console.warn('GLB failed', url, err); rej(err); })));
  }
  return cache.get(url);
}

export async function road(name) { return (await loadGLB('assets/roads/' + name + '.glb')); }

// Car normalised so its length (along +Z) is `len` units, sitting on y=0, facing +Z.
export async function car(id, len = 1.8) {
  const src = await loadGLB('assets/cars/' + id + '.glb');
  const inner = src.clone(true);
  const box = new THREE.Box3().setFromObject(inner);
  const size = box.getSize(new THREE.Vector3());
  const isKart = id.startsWith('kart');
  const s = (isKart ? len * 0.82 : len) / Math.max(size.z, 0.001);
  inner.scale.setScalar(s);
  inner.position.y = -box.min.y * s;
  const wheels = [];
  inner.traverse(o => { if (/wheel/i.test(o.name) && !o.isMesh) wheels.push(o); else if (/wheel/i.test(o.name) && o.isMesh && !wheels.includes(o.parent)) wheels.push(o); });
  const g = new THREE.Group();
  g.add(inner);
  g.userData = { inner, wheels, width: size.x * s, length: size.z * s, height: size.y * s };
  return g;
}

export async function trophy(height = 1.4) {
  const src = await loadGLB('assets/trophy.glb');
  const t = src.clone(true);
  const box = new THREE.Box3().setFromObject(t);
  const size = box.getSize(new THREE.Vector3());
  const s = height / size.y;
  t.scale.setScalar(s);
  t.position.y = -box.min.y * s;
  t.traverse(o => {
    if (o.isMesh && o.material) {
      o.material = o.material.clone();
      if ('metalness' in o.material) { o.material.metalness = Math.max(0.6, o.material.metalness || 0); o.material.roughness = Math.min(0.35, o.material.roughness ?? 0.35); }
      o.material.envMapIntensity = 1.4;
    }
  });
  const g = new THREE.Group(); g.add(t);
  return g;
}

// Text on a canvas -> texture
export function textTexture(lines, opt = {}) {
  const w = opt.w || 512, h = opt.h || 128;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  if (opt.bg) { x.fillStyle = opt.bg; x.fillRect(0, 0, w, h); }
  if (opt.draw) opt.draw(x, w, h);
  x.fillStyle = opt.color || '#fff';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  const arr = Array.isArray(lines) ? lines : [lines];
  arr.forEach((l, i) => {
    x.font = (opt.weight || 900) + ' ' + (opt.size || 72) + 'px ' + (opt.font || 'Titillium Web, Arial, sans-serif');
    x.fillText(l, w / 2, h / 2 + (i - (arr.length - 1) / 2) * (opt.size || 72) * 1.05);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
