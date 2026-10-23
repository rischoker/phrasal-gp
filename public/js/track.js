// Track builder: turtle commands -> road tiles + centerline (pure JS, no three.js)
// Commands: S = straight, R/L = tight bend (1 tile), r/l = wide curve (2x2 tiles)
// Directions: 0=E(+x) 1=S(+z) 2=W(-x) 3=N(-z)
export const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

// rotation k (multiples of 90deg around +Y in three.js) maps dir d -> (d - k) mod 4
function rotFor(baseEdges, edges) {
  for (let k = 0; k < 4; k++) {
    const r = baseEdges.map(e => ((e - k) % 4 + 4) % 4).sort().join();
    if (r === edges.slice().sort().join()) return k;
  }
  return 0;
}

export function buildTrack(cmds) {
  let px = 0, pz = 0, h = 0;
  const tiles = [], pts = [], kinds = [], cells = new Map();
  const occupy = (x, z, what) => {
    const k = x + ',' + z;
    if (cells.has(k)) throw new Error('overlap at ' + k + ' (' + what + ')');
    cells.set(k, what);
  };
  const seq = cmds.replace(/\s+/g, '');
  for (let i = 0; i < seq.length; i++) {
    const c = seq[i];
    const d = DIRS[h];
    const entry = [px - d[0] * 0.5, pz - d[1] * 0.5];
    if (c === 'S') {
      occupy(px, pz, 'S');
      tiles.push({ type: 'straight', x: px, z: pz, rot: (h % 2) ? 1 : 0, h });
      const n = 4;
      for (let j = 0; j < n; j++) { pts.push([entry[0] + d[0] * j / n, entry[1] + d[1] * j / n]); kinds.push(0); }
      px += d[0]; pz += d[1];
    } else {
      const right = c === 'R' || c === 'r';
      const big = c === 'r' || c === 'l';
      const h2 = right ? (h + 1) % 4 : (h + 3) % 4;
      const d2 = DIRS[h2];
      const R = big ? 1.5 : 0.5;
      const center = [entry[0] + d2[0] * R, entry[1] + d2[1] * R];
      // arc from entry to exit
      const a0 = Math.atan2(entry[1] - center[1], entry[0] - center[0]);
      const sweep = right ? Math.PI / 2 : -Math.PI / 2; // +z is "down": right turn = increasing angle
      const n = big ? 12 : 6;
      for (let j = 0; j < n; j++) {
        const a = a0 + sweep * j / n;
        pts.push([center[0] + Math.cos(a) * R, center[1] + Math.sin(a) * R]); kinds.push(big ? (right ? 2 : -2) : (right ? 1 : -1));
      }
      const edges = [(h + 2) % 4, h2]; // entry side, exit side
      const rot = rotFor([2, 1], edges);
      if (!big) {
        occupy(px, pz, c);
        tiles.push({ type: 'bend', x: px, z: pz, rot, h });
        px += d2[0]; pz += d2[1];
      } else {
        const cs = [[px, pz], [px + d[0], pz + d[1]], [px + d2[0], pz + d2[1]], [px + d[0] + d2[0], pz + d[1] + d2[1]]];
        cs.forEach(q => occupy(q[0], q[1], c));
        tiles.push({ type: 'curve', x: (cs[0][0] + cs[3][0]) / 2, z: (cs[0][1] + cs[3][1]) / 2, rot, h, cells: cs });
        px += d[0] + 2 * d2[0]; pz += d[1] + 2 * d2[1];
      }
      h = h2;
    }
  }
  const closed = px === 0 && pz === 0 && h === 0;
  // bounds (cell units, edges)
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const k of cells.keys()) {
    const [x, z] = k.split(',').map(Number);
    minX = Math.min(minX, x - 0.5); maxX = Math.max(maxX, x + 0.5); minZ = Math.min(minZ, z - 0.5); maxZ = Math.max(maxZ, z + 0.5);
  }
  return { tiles, pts, kinds, cells, closed, end: [px, pz, h], bounds: { minX, maxX, minZ, maxZ } };
}

export const CIRCUITS = [
  {
    id: 'boston', name: 'Boston Grand Prix', short: 'BOSTON', flag: 'US', theme: 'harbour',
    cmds: 'SSSSSS r SS r S R L L R SSS r SS r',
    blurb: 'Harbour circuit with a tricky chicane by the docks.',
  },
  {
    id: 'bogota', name: 'Bogotá Grand Prix', short: 'BOGOTÁ', flag: 'CO', theme: 'andes',
    cmds: 'SSS L R S R L SS r S R L S r SSSS R L SS r SS r',
    blurb: 'Twisty mountain-city layout under the Andes sky.',
  },
  {
    id: 'monaco', name: 'Monte Carlo Grand Prix', short: 'MONACO', flag: 'MC', theme: 'riviera',
    cmds: 'SSSSS R R L L S L R SS r SS r SSSSSSSSS r SSS r',
    blurb: 'Tight streets, a hairpin and a sprint along the sea.',
  },
  {
    id: 'tokyo', name: 'Tokyo Night Grand Prix', short: 'TOKYO', flag: 'JP', theme: 'night',
    cmds: 'SSSS r S l L S r S r SSS r SSSSSSSSSS r SSSS r',
    blurb: 'Neon night race through the city blocks.',
  },
  {
    id: 'london', name: 'London Grand Prix', short: 'LONDON', flag: 'GB', theme: 'park',
    cmds: 'SSSSSSS r S r S l r SSS r SSSS r',
    blurb: 'Fast park circuit with an S-bend in the middle.',
  },
  {
    id: 'paris', name: 'Paris Grand Prix', short: 'PARIS', flag: 'FR', theme: 'paris',
    cmds: 'SSSSSSSS r SSS R R L S L r SSSSS r SSS r',
    blurb: 'Round the Eiffel Tower, with a hairpin by the Arc de Triomphe.',
  },
  {
    id: 'cairo', name: 'Cairo Grand Prix', short: 'CAIRO', flag: 'EG', theme: 'desert',
    cmds: 'SSSSSSS r SSS r SSSSSSS r S L R R L r',
    blurb: 'Desert sprint past the Pyramids and the Sphinx, by the Nile.',
  },
  {
    id: 'rio', name: 'Rio de Janeiro Grand Prix', short: 'RIO', flag: 'BR', theme: 'tropical',
    cmds: 'SSSSS r L R SS r SSSSSSSS r SSS R R L L r',
    blurb: 'Beach circuit around the Maracanã, under Christ the Redeemer.',
  },
];
