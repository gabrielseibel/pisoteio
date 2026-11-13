// =============================================================
// Renderização em Canvas 2D, vista de cima (como o trailer de referência)
// =============================================================
import { TILE, isSolid, STATE, FlowField } from './sim.js';

// mapa de calor: azul → ciano → verde → amarelo → vermelho
const STOPS = [
  [0.00, [40, 90, 220]],
  [0.25, [40, 190, 230]],
  [0.45, [70, 200, 90]],
  [0.65, [245, 210, 50]],
  [0.82, [245, 120, 40]],
  [1.00, [220, 30, 40]],
];
export function heat(t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i][0]) {
      const [t0, a] = STOPS[i - 1], [t1, b] = STOPS[i];
      const k = (t - t0) / (t1 - t0);
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    }
  }
  return STOPS[STOPS.length - 1][1];
}

const ROOFS = ['#d9d4c9', '#c8c3b8', '#b7b9b4', '#d6cbbb', '#9fb39a', '#c9b7a3', '#a9aeb3', '#d8c7b0'];

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.staticLayer = document.createElement('canvas');
    this.heatLayer = document.createElement('canvas');
    this.ppm = 10;
    this.particles = [];
    this.hover = null;
    this.shake = 0;
  }

  setWorld(world) {
    this.world = world;
    this.heatLayer.width = world.W; this.heatLayer.height = world.H;
    this.heatImg = this.heatLayer.getContext('2d').createImageData(world.W, world.H);
    this.resize();
    this.rebuildPreview();
  }

  resize() {
    if (!this.world) return;
    const box = this.canvas.parentElement.getBoundingClientRect();
    const { W, H } = this.world;
    const ppm = Math.max(4, Math.min(box.width / W, box.height / H));
    this.ppm = ppm;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.canvas.style.width = `${Math.floor(W * ppm)}px`;
    this.canvas.style.height = `${Math.floor(H * ppm)}px`;
    this.canvas.width = Math.floor(W * ppm * dpr);
    this.canvas.height = Math.floor(H * ppm * dpr);
    this.staticLayer.width = this.canvas.width;
    this.staticLayer.height = this.canvas.height;
    this.drawStatic();
  }

  // célula sob o ponteiro
  cellAt(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const x = Math.floor((clientX - r.left) / this.ppm);
    const y = Math.floor((clientY - r.top) / this.ppm);
    return { x, y };
  }

  // ---------------- camada fixa (chão, prédios, palco, grades) ----------------
  drawStatic() {
    const w = this.world; if (!w) return;
    const c = this.staticLayer.getContext('2d');
    const s = this.ppm * this.dpr;
    const { W, H, tiles } = w;
    c.setTransform(1, 0, 0, 1, 0, 0);
    // chão de concreto
    c.fillStyle = '#bebdb8';
    c.fillRect(0, 0, W * s, H * s);
    // confete no chão (detalhe do vídeo) — pseudo-aleatório estável
    let seed = 1234;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const conf = ['#e05a5a', '#f2c94c', '#56ccf2', '#6fcf97', '#bb6bd9', '#ffffff'];
    for (let k = 0; k < W * H * 0.6; k++) {
      c.fillStyle = conf[(rnd() * conf.length) | 0];
      c.globalAlpha = 0.55;
      c.fillRect(rnd() * W * s, rnd() * H * s, s * 0.08, s * 0.08);
    }
    c.globalAlpha = 1;
    // grade do piso
    c.strokeStyle = 'rgba(0,0,0,0.06)'; c.lineWidth = 1;
    c.beginPath();
    for (let x = 0; x <= W; x++) { c.moveTo(x * s + 0.5, 0); c.lineTo(x * s + 0.5, H * s); }
    for (let y = 0; y <= H; y++) { c.moveTo(0, y * s + 0.5); c.lineTo(W * s, y * s + 0.5); }
    c.stroke();
    // zonas de plateia
    for (let i = 0; i < tiles.length; i++) {
      if (w.zone[i] < 0) continue;
      const x = i % W, y = (i / W) | 0;
      c.fillStyle = w.zone[i] === 0 ? 'rgba(255,255,255,0.10)' : 'rgba(255,230,180,0.12)';
      c.fillRect(x * s, y * s, s, s);
    }
    // contorno tracejado e rótulo das plateias
    c.save();
    c.setLineDash([s * 0.4, s * 0.3]);
    c.strokeStyle = 'rgba(255,255,255,0.55)';
    c.lineWidth = Math.max(1, s * 0.08);
    const zones = [...new Set(w.zone)].filter(z => z >= 0);
    for (const z of zones) {
      this.outlineCells(c, s, i => w.zone[i] === z);
      let minX = W, minY = H, maxX = 0;
      for (let i = 0; i < tiles.length; i++) if (w.zone[i] === z) {
        const x = i % W, y = (i / W) | 0;
        minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x);
      }
      c.fillStyle = 'rgba(255,255,255,0.6)';
      c.font = `800 ${Math.max(9, s * 0.75)}px Inter, system-ui, sans-serif`;
      c.textAlign = 'right';
      c.fillText(zones.length > 1 ? `PLATEIA ${z + 1}` : 'PLATEIA', (maxX + 0.6) * s, (minY + 1.6) * s);
    }
    c.restore();
    // decoração (parque)
    for (const d of w.level.decor || []) {
      if (d.type === 'park') {
        c.fillStyle = '#4f7d3b';
        c.fillRect(d.x * s, d.y * s, d.w * s, d.h * s);
      }
    }
    // sombras dos elementos altos
    c.fillStyle = 'rgba(0,0,0,0.28)';
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if (t === TILE.BUILDING || t === TILE.STAGE || t === TILE.WALL) {
        const x = i % W, y = (i / W) | 0;
        const off = t === TILE.BUILDING ? 0.55 : 0.3;
        c.fillRect((x + off) * s, (y + off) * s, s, s);
      }
    }
    // prédios: uma cor por bloco conectado
    const comp = this.components(TILE.BUILDING);
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      const x = i % W, y = (i / W) | 0;
      if (t === TILE.BUILDING) {
        c.fillStyle = ROOFS[comp[i] % ROOFS.length];
        c.fillRect(x * s, y * s, s + 0.5, s + 0.5);
      } else if (t === TILE.WALL) {
        c.fillStyle = '#4b4b4d';
        c.fillRect(x * s, y * s, s + 0.5, s + 0.5);
      } else if (t === TILE.STAGE) {
        c.fillStyle = '#f1f0ec';
        c.fillRect(x * s, y * s, s + 0.5, s + 0.5);
      }
    }
    // detalhes de telhado (caixas d'água, ar-condicionado)
    seed = 99;
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] !== TILE.BUILDING || rnd() > 0.18) continue;
      const x = i % W, y = (i / W) | 0;
      c.fillStyle = 'rgba(0,0,0,0.18)';
      c.fillRect((x + 0.25) * s, (y + 0.25) * s, s * 0.45, s * 0.45);
    }
    // contorno dos prédios
    c.strokeStyle = 'rgba(0,0,0,0.25)';
    c.lineWidth = Math.max(1, s * 0.06);
    this.outline(c, s, t => t === TILE.BUILDING);
    this.outline(c, s, t => t === TILE.STAGE);
    // árvores do parque
    for (const d of w.level.decor || []) {
      if (d.type !== 'park') continue;
      seed = 7;
      for (let k = 0; k < d.w * d.h * 0.7; k++) {
        const px = (d.x + 0.4 + rnd() * (d.w - 0.8)) * s, py = (d.y + 0.4 + rnd() * (d.h - 0.8)) * s;
        c.fillStyle = 'rgba(0,0,0,0.25)';
        c.beginPath(); c.arc(px + s * 0.25, py + s * 0.25, s * 0.55, 0, 7); c.fill();
        c.fillStyle = ['#3f8a3a', '#4f9d42', '#2f7330'][k % 3];
        c.beginPath(); c.arc(px, py, s * 0.55, 0, 7); c.fill();
      }
    }
    // luzes do palco
    const lights = ['#ff6b6b', '#ffd166', '#06d6a0', '#4cc9f0', '#c77dff'];
    let li = 0;
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] !== TILE.STAGE) continue;
      const x = i % W, y = (i / W) | 0;
      if (w.tileAt(x, y + 1) !== TILE.STAGE && !isSolid(w.tileAt(x, y + 1)) && x % 2 === 0) {
        c.fillStyle = lights[li++ % lights.length];
        c.beginPath(); c.arc((x + 0.5) * s, (y + 0.8) * s, s * 0.18, 0, 7); c.fill();
      }
    }
    // portões
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] !== TILE.GATE) continue;
      const x = i % W, y = (i / W) | 0;
      c.fillStyle = w.placed[i] ? '#8fd18f' : '#f2c94c';
      c.fillRect(x * s, y * s, s, s);
      c.fillStyle = 'rgba(0,0,0,0.35)';
      // listras
      for (let k = 0; k < 3; k++) c.fillRect(x * s + k * s / 3, y * s, s / 6, s);
      if (w.spawn[i]) { // seta de entrada
        const cx = (x + 0.5) * s, cy = (y + 0.5) * s;
        const ix = x === 0 ? 1 : x === W - 1 ? -1 : 0, iy = y === 0 ? 1 : y === H - 1 ? -1 : 0;
        c.fillStyle = '#ffffff';
        c.beginPath();
        c.moveTo(cx + ix * s * 0.35, cy + iy * s * 0.35);
        c.lineTo(cx - ix * s * 0.25 + iy * s * 0.3, cy - iy * s * 0.25 + ix * s * 0.3);
        c.lineTo(cx - ix * s * 0.25 - iy * s * 0.3, cy - iy * s * 0.25 - ix * s * 0.3);
        c.fill();
      }
    }
    // grades do jogador (barreiras pretas, como no vídeo)
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] !== TILE.FENCE) continue;
      const x = i % W, y = (i / W) | 0;
      const cx = (x + 0.5) * s, cy = (y + 0.5) * s, hw = s * 0.22;
      c.fillStyle = 'rgba(0,0,0,0.3)';
      c.fillRect(cx - hw + s * 0.15, cy - hw + s * 0.15, hw * 2, hw * 2);
      c.fillStyle = '#2a2a2c';
      c.fillRect(cx - hw, cy - hw, hw * 2, hw * 2);
      const link = (ox, oy) => {
        const t = w.tileAt(x + ox, y + oy);
        return t === TILE.FENCE || t === TILE.WALL || t === TILE.BUILDING || t === TILE.STAGE;
      };
      if (link(1, 0)) c.fillRect(cx, cy - hw, s * 0.5 + 1, hw * 2);
      if (link(-1, 0)) c.fillRect(x * s, cy - hw, s * 0.5, hw * 2);
      if (link(0, 1)) c.fillRect(cx - hw, cy, hw * 2, s * 0.5 + 1);
      if (link(0, -1)) c.fillRect(cx - hw, y * s, hw * 2, s * 0.5);
    }
  }

  components(type) {
    const { W, H, tiles } = this.world;
    const comp = new Int32Array(tiles.length).fill(-1);
    let id = 0;
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] !== type || comp[i] >= 0) continue;
      const stack = [i]; comp[i] = id;
      while (stack.length) {
        const j = stack.pop(); const x = j % W, y = (j / W) | 0;
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + ox, ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const k = ny * W + nx;
          if (tiles[k] === type && comp[k] < 0) { comp[k] = id; stack.push(k); }
        }
      }
      id = (id * 7 + 3) % 997 + 1;
    }
    return comp;
  }

  outlineCells(c, s, predIdx) {
    const { W, H } = this.world;
    const ok = (x, y) => x >= 0 && y >= 0 && x < W && y < H && predIdx(y * W + x);
    c.beginPath();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!ok(x, y)) continue;
      if (!ok(x, y - 1)) { c.moveTo(x * s, y * s); c.lineTo((x + 1) * s, y * s); }
      if (!ok(x, y + 1)) { c.moveTo(x * s, (y + 1) * s); c.lineTo((x + 1) * s, (y + 1) * s); }
      if (!ok(x - 1, y)) { c.moveTo(x * s, y * s); c.lineTo(x * s, (y + 1) * s); }
      if (!ok(x + 1, y)) { c.moveTo((x + 1) * s, y * s); c.lineTo((x + 1) * s, (y + 1) * s); }
    }
    c.stroke();
  }

  outline(c, s, pred) {
    const { W, H, tiles } = this.world;
    c.beginPath();
    for (let i = 0; i < tiles.length; i++) {
      if (!pred(tiles[i])) continue;
      const x = i % W, y = (i / W) | 0;
      const nb = (ox, oy) => { const nx = x + ox, ny = y + oy; return nx >= 0 && ny >= 0 && nx < W && ny < H && pred(tiles[ny * W + nx]); };
      if (!nb(0, -1)) { c.moveTo(x * s, y * s); c.lineTo((x + 1) * s, y * s); }
      if (!nb(0, 1)) { c.moveTo(x * s, (y + 1) * s); c.lineTo((x + 1) * s, (y + 1) * s); }
      if (!nb(-1, 0)) { c.moveTo(x * s, y * s); c.lineTo(x * s, (y + 1) * s); }
      if (!nb(1, 0)) { c.moveTo((x + 1) * s, y * s); c.lineTo((x + 1) * s, (y + 1) * s); }
    }
    c.stroke();
  }

  // ---------------- prévia de fluxo (modo planejamento) ----------------
  rebuildPreview() {
    const w = this.world;
    const firstZone = w.level.phases.find(p => p.zone !== undefined).zone;
    this.entryField = this.entryField || new FlowField(w);
    this.exitField = this.exitField || new FlowField(w);
    if (this.entryField.w !== w) { this.entryField = new FlowField(w); this.exitField = new FlowField(w); }
    this.entryField.compute(w.stageEdgeCells()); // como no trailer: rastros até o palco
    this.exitField.compute(w.gateCells());
    this.spawnCells = w.spawnCells();
    this.zoneCells = w.zoneCells(w.level.phases[w.level.phases.length - 2]?.zone ?? firstZone);
    this.particles = [];
    const n = Math.min(260, 90 + this.spawnCells.length * 10);
    for (let k = 0; k < n; k++) this.particles.push(this.newParticle(k % 3 !== 0, Math.random() * 3));
  }

  newParticle(entry, age = 0) {
    const W = this.world.W;
    const pool = entry ? this.spawnCells : this.zoneCells;
    const cell = pool[(Math.random() * pool.length) | 0] ?? 0;
    return {
      entry, x: (cell % W) + 0.2 + Math.random() * 0.6, y: ((cell / W) | 0) + 0.2 + Math.random() * 0.6,
      trail: [], age, life: 6 + Math.random() * 6, d0: null, lat: (Math.random() - 0.5) * 0.9,
    };
  }

  drawPreview(c, dt) {
    const s = this.ppm * this.dpr;
    const dir = [0, 0];
    c.lineCap = 'round';
    for (let k = 0; k < this.particles.length; k++) {
      let p = this.particles[k];
      const f = p.entry ? this.entryField : this.exitField;
      const ci = (p.y | 0) * this.world.W + (p.x | 0);
      const dist = f.dist[ci];
      if (p.d0 === null) p.d0 = isFinite(dist) ? Math.max(1, dist) : 1;
      p.age += dt;
      if (!isFinite(dist) || dist < 0.8 || p.age > p.life) { this.particles[k] = this.newParticle(p.entry); continue; }
      f.sample(p.x, p.y, dir);
      // leque: deriva lateral própria de cada rastro, como no trailer
      p.x += (dir[0] - dir[1] * p.lat) * 7 * dt; p.y += (dir[1] + dir[0] * p.lat) * 7 * dt;
      const tl = p.trail.length;
      // o último ponto é a "cabeça" móvel; fixa um novo ponto a cada 35 cm
      if (tl < 4 || Math.hypot(p.x - p.trail[tl - 4], p.y - p.trail[tl - 3]) > 0.35) p.trail.push(p.x, p.y);
      else { p.trail[tl - 2] = p.x; p.trail[tl - 1] = p.y; }
      if (p.trail.length > (p.entry ? 70 : 40)) p.trail.splice(0, 2);
      const prog = 1 - Math.min(1, dist / p.d0);
      for (let j = 2; j < p.trail.length; j += 2) {
        const a = j / p.trail.length;
        if (p.entry) {
          const col = heat(0.25 + prog * 0.6);
          c.strokeStyle = `rgba(${col[0] | 0},${col[1] | 0},${col[2] | 0},${a * 0.75})`;
        } else {
          c.strokeStyle = `rgba(235,245,255,${a * 0.55})`;
        }
        c.lineWidth = Math.max(1.5, s * (p.entry ? 0.2 : 0.12));
        c.beginPath();
        c.moveTo(p.trail[j - 2] * s, p.trail[j - 1] * s);
        c.lineTo(p.trail[j] * s, p.trail[j + 1] * s);
        c.stroke();
      }
    }
  }

  // ---------------- quadro dinâmico ----------------
  frame(sim, opts, dt) {
    const c = this.ctx;
    const s = this.ppm * this.dpr;
    c.setTransform(1, 0, 0, 1, 0, 0);
    let sx = 0, sy = 0;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 3);
      sx = (Math.random() - 0.5) * this.shake * s * 0.6;
      sy = (Math.random() - 0.5) * this.shake * s * 0.6;
    }
    c.setTransform(1, 0, 0, 1, sx, sy);
    c.drawImage(this.staticLayer, 0, 0);

    if (!sim) {
      if (opts.preview) this.drawPreview(c, dt);
      this.drawHover(c, s, opts);
      return;
    }

    const { W, H } = this.world;
    const danger = sim.p.dangerDensity;

    // mapa de calor suave
    if (opts.heat) {
      const img = this.heatImg.data;
      for (let i = 0; i < W * H; i++) {
        const d = sim.density[i];
        const o = i * 4;
        if (d < 0.25 || isSolid(this.world.tiles[i])) { img[o + 3] = 0; continue; }
        const col = heat(d / danger);
        img[o] = col[0]; img[o + 1] = col[1]; img[o + 2] = col[2];
        img[o + 3] = Math.min(200, 60 + d * 30);
      }
      this.heatLayer.getContext('2d').putImageData(this.heatImg, 0, 0);
      c.imageSmoothingEnabled = true;
      c.globalAlpha = 0.6;
      c.drawImage(this.heatLayer, 0, 0, W * s, H * s);
      c.globalAlpha = 1;
    }

    // pessoas
    const r = Math.max(1.2, sim.p.radius * s * 1.05);
    for (let i = 0; i < sim.N; i++) {
      const st = sim.state[i];
      if (st === STATE.GONE) continue;
      const x = sim.x[i] * s, y = sim.y[i] * s;
      if (st === STATE.FALLEN) {
        c.strokeStyle = '#7a0d12'; c.lineWidth = Math.max(1.5, s * 0.12);
        c.beginPath();
        c.moveTo(x - r, y - r); c.lineTo(x + r, y + r);
        c.moveTo(x + r, y - r); c.lineTo(x - r, y + r);
        c.stroke();
        continue;
      }
      if (opts.heat) {
        const col = heat(sim.localD[i] / danger);
        c.fillStyle = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`;
      } else {
        c.fillStyle = `hsl(${sim.hue[i]},55%,${48 + (i % 3) * 6}%)`;
      }
      c.beginPath(); c.arc(x, y, r, 0, 6.283); c.fill();
      // "cabeça" escura, dá leitura de gente vista de cima
      c.fillStyle = 'rgba(30,20,15,0.55)';
      c.beginPath(); c.arc(x, y, r * 0.45, 0, 6.283); c.fill();
    }

    // flash nas quedas
    for (const e of sim.events) {
      const age = sim.time - e.t;
      if (age > 1.2) continue;
      c.strokeStyle = `rgba(255,40,40,${1 - age / 1.2})`;
      c.lineWidth = Math.max(2, s * 0.15);
      c.beginPath(); c.arc(e.x * s, e.y * s, (0.4 + age * 2.2) * s, 0, 6.283); c.stroke();
    }
  }

  drawHover(c, s, opts) {
    const h = this.hover;
    if (!h || !opts.tool || !this.world.inside(h.x, h.y)) return;
    const ok = this.world.canPlace(opts.tool, h.x, h.y);
    c.strokeStyle = ok ? '#2ecc71' : '#e74c3c';
    c.lineWidth = Math.max(2, s * 0.12);
    c.strokeRect(h.x * s + 1, h.y * s + 1, s - 2, s - 2);
  }
}
