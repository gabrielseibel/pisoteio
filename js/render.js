// =============================================================
// Renderização em Canvas 2D, vista de cima, com câmera (zoom e arrasto)
// Tudo é desenhado em METROS com uma transformação de câmera.
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
const HEAT_STEPS = 24;
const HEAT_CSS = Array.from({ length: HEAT_STEPS }, (_, k) => {
  const c = heat(k / (HEAT_STEPS - 1));
  return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
});
const SHIRTS = ['#e74c3c', '#3498db', '#f1c40f', '#2ecc71', '#ecf0f1', '#9b59b6', '#e67e22', '#1abc9c',
  '#34495e', '#fd79a8', '#c0392b', '#2c3e50', '#f5f6fa', '#6c5ce7', '#00b894', '#fab1a0'];
const ABADAS = ['#ff2d7a', '#ffd400', '#00d1ff', '#7cff4f', '#ff7a00', '#b84dff', '#ffffff'];
const HAIR = ['#2b1d14', '#3b2a1e', '#1a1a1a', '#6b4a2b', '#c9a15b', '#5a3a22'];
const ROOFS = ['#d9d4c9', '#c8c3b8', '#b7b9b4', '#d6cbbb', '#9fb39a', '#c9b7a3', '#a9aeb3', '#d8c7b0', '#b9a38f', '#c7cfd4'];
const ROOFS_NIGHT = ['#2e3138', '#34363d', '#2a2c31', '#383a40', '#30343a', '#2b2e35'];
const LIGHTS = ['#ff4d6d', '#ffd166', '#06d6a0', '#4cc9f0', '#c77dff', '#ff8fab'];

const ease = (a, b, k) => a + (b - a) * k;

// paleta única: calor (0..23), camisetas, abadás, mosaico
function buildPalette() {
  const css = [...HEAT_CSS];
  const shirt = css.length; css.push(...SHIRTS);
  const abada = css.length; css.push(...ABADAS);
  const tifo = css.length; css.push('#c8102e', '#f5f5f5', '#ffd400');
  return { css, shirt, abada, tifo };
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.staticLayer = document.createElement('canvas');
    this.heatLayer = document.createElement('canvas');
    this.cam = { x: 0, y: 0, z: 10 };
    this.camT = null;     // alvo da câmera (animações e câmera do perigo)
    this.particles = [];
    this.confetti = [];
    this.sparks = [];     // fogos de artifício
    this.rockets = [];
    this.hover = null;
    this.shake = 0;
    this.time = 0;
    this.lastPhase = -1;
    this.palette = buildPalette();
    const n = this.palette.css.length;
    this.palCount = new Int32Array(n); this.palStart = new Int32Array(n); this.palFill = new Int32Array(n);
    this.glows = new Map();
    // qualidade: 1 = completa, 0 = econômica (sem sombras, fachos e vinheta; resolução menor)
    this.mobile = matchMedia('(pointer: coarse)').matches;
    this.quality = 1;
    this.frameMs = 16;
  }

  // brilho pronto (sprite radial) — muito mais barato que criar gradientes a cada quadro
  glow(color) {
    let g = this.glows.get(color);
    if (g) return g;
    g = document.createElement('canvas'); g.width = g.height = 64;
    const c = g.getContext('2d');
    const grd = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, color); grd.addColorStop(0.4, hexA(color, 0.45)); grd.addColorStop(1, hexA(color, 0));
    c.fillStyle = grd; c.fillRect(0, 0, 64, 64);
    this.glows.set(color, g);
    return g;
  }

  // mede o custo dos quadros e baixa a qualidade se o aparelho não acompanhar
  trackPerf(ms) {
    this.frameMs = this.frameMs * 0.95 + ms * 0.05;
    if (this.quality === 1 && this.frameMs > 26) { this.quality = 0; this.resize(); }
  }

  // ---------------- mundo e câmera ----------------
  setWorld(world) {
    this.world = world;
    const { W, H } = world;
    this.heatLayer.width = W; this.heatLayer.height = H;
    this.heatImg = this.heatLayer.getContext('2d').createImageData(W, H);
    this.S = Math.max(8, Math.min(32, Math.floor(Math.sqrt((this.mobile ? 2.5e6 : 5e6) / (W * H))))); // px por metro da camada fixa
    this.staticLayer.width = W * this.S;
    this.staticLayer.height = H * this.S;
    this.night = !!world.level.night;
    this.stageLights = this.findStageLights();
    this.confetti = []; this.sparks = []; this.rockets = [];
    this.lastPhase = -1;
    this.heatReady = false;
    this.resize();
    // abertura cinematográfica: começa perto do palco e afasta
    const f = this.fitView();
    const focus = this.focusPoint();
    this.cam = { x: focus.x, y: focus.y, z: f.z * 2.8 };
    this.camT = { ...f, speed: 1.6 };
    this.drawStatic();
    this.rebuildPreview();
  }

  resize() {
    if (!this.world) return;
    const box = this.canvas.parentElement.getBoundingClientRect();
    this.vw = Math.max(1, box.width); this.vh = Math.max(1, box.height);
    this.dpr = Math.min(this.quality ? (this.mobile ? 1.5 : 2) : 1, window.devicePixelRatio || 1);
    this.vignette = null;
    this.canvas.style.width = `${this.vw}px`;
    this.canvas.style.height = `${this.vh}px`;
    this.canvas.width = Math.floor(this.vw * this.dpr);
    this.canvas.height = Math.floor(this.vh * this.dpr);
    this.clampCam();
  }

  fitView() {
    const { W, H } = this.world;
    const z = Math.min((this.vw - 16) / W, (this.vh - 16) / H);
    return { x: W / 2, y: H / 2, z };
  }
  get minZ() { return this.fitView().z * 0.85; }
  get maxZ() { return 60; }

  focusPoint() {
    const w = this.world;
    if (w.level.parade) { const [x, y] = w.level.parade.path[0]; return { x, y }; }
    if (this.stageLights.length) {
      let sx = 0, sy = 0;
      for (const l of this.stageLights) { sx += l.x; sy += l.y; }
      return { x: sx / this.stageLights.length, y: sy / this.stageLights.length };
    }
    if (w.level.pitch) { const p = w.level.pitch; return { x: p.x + p.w / 2, y: p.y + p.h / 2 }; }
    return { x: w.W / 2, y: w.H / 2 };
  }

  fit() { this.camT = { ...this.fitView(), speed: 6 }; }

  clampCam() {
    const { W, H } = this.world;
    const c = this.cam;
    c.z = Math.max(this.minZ, Math.min(this.maxZ, c.z));
    const hw = this.vw / 2 / c.z, hh = this.vh / 2 / c.z;
    c.x = hw * 2 >= W ? W / 2 : Math.max(hw - 2, Math.min(W - hw + 2, c.x));
    c.y = hh * 2 >= H ? H / 2 : Math.max(hh - 2, Math.min(H - hh + 2, c.y));
  }

  screenToWorld(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const sx = clientX - r.left, sy = clientY - r.top;
    return { x: this.cam.x + (sx - this.vw / 2) / this.cam.z, y: this.cam.y + (sy - this.vh / 2) / this.cam.z };
  }
  cellAt(clientX, clientY) {
    const p = this.screenToWorld(clientX, clientY);
    return { x: Math.floor(p.x), y: Math.floor(p.y) };
  }
  zoomAt(factor, clientX, clientY) {
    this.camT = null;
    const before = this.screenToWorld(clientX, clientY);
    this.cam.z = Math.max(this.minZ, Math.min(this.maxZ, this.cam.z * factor));
    const after = this.screenToWorld(clientX, clientY);
    this.cam.x += before.x - after.x;
    this.cam.y += before.y - after.y;
    this.clampCam();
  }
  zoomCenter(factor) {
    const r = this.canvas.getBoundingClientRect();
    this.zoomAt(factor, r.left + this.vw / 2, r.top + this.vh / 2);
  }
  panBy(dx, dy) {
    this.camT = null;
    this.cam.x -= dx / this.cam.z; this.cam.y -= dy / this.cam.z;
    this.clampCam();
  }

  updateCamera(dt, sim, follow) {
    if (follow && sim && sim.hot.d > 3.2) {
      this.camT = { x: sim.hot.x, y: sim.hot.y, z: Math.max(this.fitView().z * 2.6, 14), speed: 1.4, follow: true };
    } else if (follow && this.camT?.follow && sim && sim.hot.d < 2.5) {
      this.camT = { ...this.fitView(), speed: 1, follow: true };
    }
    const t = this.camT;
    if (!t) return;
    const k = 1 - Math.exp(-dt * (t.speed || 3));
    this.cam.x = ease(this.cam.x, t.x, k);
    this.cam.y = ease(this.cam.y, t.y, k);
    this.cam.z = ease(this.cam.z, t.z, k);
    this.clampCam();
    if (!t.follow && Math.abs(this.cam.z - t.z) < 0.01 * t.z && Math.hypot(this.cam.x - t.x, this.cam.y - t.y) < 0.05) this.camT = null;
  }

  findStageLights() {
    const w = this.world, out = [];
    for (let y = 0; y < w.H; y++) for (let x = 0; x < w.W; x++) {
      if (w.tileAt(x, y) !== TILE.STAGE) continue;
      // borda do palco voltada para o público
      for (const [ox, oy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const t = w.tileAt(x + ox, y + oy);
        if (!isSolid(t) && t !== TILE.GATE && (x + y) % 2 === 0) {
          out.push({ x: x + 0.5 + ox * 0.45, y: y + 0.5 + oy * 0.45, dx: ox, dy: oy, c: LIGHTS[out.length % LIGHTS.length] });
        }
      }
    }
    return out;
  }

  // ---------------- camada fixa ----------------
  drawStatic() {
    const w = this.world; if (!w) return;
    const c = this.staticLayer.getContext('2d');
    const S = this.S;
    const { W, H, tiles } = w;
    const night = this.night;
    c.setTransform(S, 0, 0, S, 0, 0);
    c.lineJoin = 'round';
    let seed = 1234;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

    // chão
    c.fillStyle = night ? '#2b2e34' : '#bebdb8';
    c.fillRect(0, 0, W, H);
    if (!night) { // confete no chão (detalhe do trailer)
      const conf = ['#e05a5a', '#f2c94c', '#56ccf2', '#6fcf97', '#bb6bd9', '#ffffff'];
      c.globalAlpha = 0.5;
      for (let k = 0; k < W * H * 0.5; k++) {
        c.fillStyle = conf[(rnd() * conf.length) | 0];
        c.fillRect(rnd() * W, rnd() * H, 0.08, 0.08);
      }
      c.globalAlpha = 1;
    }
    // piso: grade e faixas de pedestre
    c.strokeStyle = night ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.06)';
    c.lineWidth = 0.04;
    c.beginPath();
    for (let x = 0; x <= W; x++) { c.moveTo(x, 0); c.lineTo(x, H); }
    for (let y = 0; y <= H; y++) { c.moveTo(0, y); c.lineTo(W, y); }
    c.stroke();

    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      const x = i % W, y = (i / W) | 0;
      if (t === TILE.GRASS) {
        c.fillStyle = (x + y) % 2 ? (night ? '#223524' : '#5f9046') : (night ? '#1f3121' : '#578a40');
        c.fillRect(x, y, 1.02, 1.02);
      } else if (t === TILE.SEATS) {
        const row = this.seatRow(x, y);
        c.fillStyle = row % 2 ? '#9e2a32' : '#b8323a';
        c.fillRect(x, y, 1.02, 1.02);
        c.fillStyle = 'rgba(0,0,0,0.18)';
        c.fillRect(x, y + 0.82, 1, 0.12);
      } else if (t === TILE.STAIRS) {
        c.fillStyle = night ? '#3a3d44' : '#9a9a96';
        c.fillRect(x, y, 1.02, 1.02);
        c.fillStyle = 'rgba(0,0,0,0.25)';
        for (let k = 0; k < 3; k++) c.fillRect(x, y + k / 3, 1, 0.06);
      } else if (t === TILE.PITCH) {
        const p = w.level.pitch;
        const stripe = p ? Math.floor((y - p.y) / 3) % 2 : 0;
        c.fillStyle = stripe ? '#3f9a45' : '#45a84b';
        c.fillRect(x, y, 1.02, 1.02);
      } else if (t === TILE.TRACK) {
        c.fillStyle = '#3b3835';
        c.fillRect(x, y, 1.02, 1.02);
      }
      if (w.zone[i] >= 0 && t !== TILE.SEATS) {
        c.fillStyle = night ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.10)';
        c.fillRect(x, y, 1, 1);
      }
    }
    // linhas do campo de futebol
    if (w.level.pitch) {
      const p = w.level.pitch;
      c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 0.15;
      c.strokeRect(p.x + 1, p.y + 1, p.w - 2, p.h - 2);
      c.beginPath(); c.moveTo(p.x + 1, p.y + p.h / 2); c.lineTo(p.x + p.w - 1, p.y + p.h / 2); c.stroke();
      c.beginPath(); c.arc(p.x + p.w / 2, p.y + p.h / 2, 3.5, 0, 6.283); c.stroke();
      c.strokeRect(p.x + p.w / 2 - 5, p.y + 1, 10, 5);
      c.strokeRect(p.x + p.w / 2 - 5, p.y + p.h - 6, 10, 5);
      c.fillStyle = '#fff';
      c.fillRect(p.x + p.w / 2 - 1.8, p.y + 0.4, 3.6, 0.6);
      c.fillRect(p.x + p.w / 2 - 1.8, p.y + p.h - 1, 3.6, 0.6);
    }
    // trilhos do metrô
    for (const d of w.level.decor || []) {
      if (d.type !== 'train') continue;
      c.fillStyle = '#5a5550';
      for (let x = 0; x < W; x += 0.7) c.fillRect(x, d.y + 0.4, 0.25, d.h - 0.8);
      c.fillStyle = '#c9c9c9';
      c.fillRect(0, d.y + 1, W, 0.12); c.fillRect(0, d.y + d.h - 1.12, W, 0.12);
      c.fillStyle = '#f2c94c'; // faixa amarela da plataforma
      c.fillRect(0, d.y + d.h + 0.05, W, 0.25);
    }

    // contorno tracejado e rótulo das plateias
    c.save();
    c.setLineDash([0.4, 0.3]);
    c.strokeStyle = night ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.55)';
    c.lineWidth = 0.08;
    const zones = [...new Set(w.zone)].filter(z => z >= 0);
    for (const z of zones) {
      if (w.level.pitch) continue;
      this.outlineCells(c, i => w.zone[i] === z);
      let minY = H, maxX = 0;
      for (let i = 0; i < tiles.length; i++) if (w.zone[i] === z) {
        minY = Math.min(minY, (i / W) | 0); maxX = Math.max(maxX, i % W);
      }
      c.fillStyle = night ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.6)';
      c.font = '800 0.8px Inter, system-ui, sans-serif';
      c.textAlign = 'right';
      c.fillText(w.level.parade ? 'CONCENTRAÇÃO' : zones.length > 1 ? `PLATEIA ${z + 1}` : 'PLATEIA', maxX + 0.6, minY + 1.6);
    }
    c.restore();

    // sombras
    c.fillStyle = night ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.28)';
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if (t === TILE.BUILDING || t === TILE.STAGE || t === TILE.WALL) {
        const x = i % W, y = (i / W) | 0;
        const off = t === TILE.BUILDING ? (w.openable[i] ? 0.15 : 0.6) : 0.3;
        c.fillRect(x + off, y + off, 1, 1);
      }
    }
    // prédios, muros e palcos
    const comp = this.components(TILE.BUILDING);
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      const x = i % W, y = (i / W) | 0;
      if (t === TILE.BUILDING) {
        if (w.openable[i]) { // tapume que pode ser aberto: listras amarelas e pretas
          c.fillStyle = '#f2c94c'; c.fillRect(x, y, 1.02, 1.02);
          c.fillStyle = '#222';
          c.save(); c.beginPath(); c.rect(x, y, 1, 1); c.clip();
          for (let k = -1; k < 2; k += 0.5) { c.beginPath(); c.moveTo(x + k, y + 1); c.lineTo(x + k + 0.25, y + 1); c.lineTo(x + k + 1.25, y); c.lineTo(x + k + 1, y); c.fill(); }
          c.restore();
          continue;
        }
        const pal = night ? ROOFS_NIGHT : ROOFS;
        c.fillStyle = w.level.indoor ? '#a8a69f' : pal[comp[i] % pal.length];
        c.fillRect(x, y, 1.02, 1.02);
      } else if (t === TILE.WALL) {
        c.fillStyle = night ? '#18191c' : '#4b4b4d';
        c.fillRect(x, y, 1.02, 1.02);
      } else if (t === TILE.STAGE) {
        c.fillStyle = night ? '#d9d6cf' : '#f1f0ec';
        c.fillRect(x, y, 1.02, 1.02);
      }
    }
    // detalhes de telhado / janelas acesas à noite
    seed = 99;
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] !== TILE.BUILDING || w.openable[i] || w.level.indoor) continue;
      const x = i % W, y = (i / W) | 0;
      const r = rnd();
      if (night) {
        if (r < 0.22) { c.fillStyle = r < 0.08 ? '#ffd27a' : 'rgba(255,210,120,0.45)'; c.fillRect(x + 0.3, y + 0.3, 0.35, 0.35); }
      } else if (r < 0.16) {
        c.fillStyle = 'rgba(0,0,0,0.16)'; c.fillRect(x + 0.25, y + 0.25, 0.45, 0.45);
      } else if (r < 0.2) {
        c.fillStyle = '#7fb6d6'; c.fillRect(x + 0.15, y + 0.15, 0.7, 0.7); // piscina/claraboia
      }
    }
    c.strokeStyle = night ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.25)';
    c.lineWidth = 0.06;
    this.outline(c, (t, i) => t === TILE.BUILDING && !w.openable[i]);
    this.outline(c, t => t === TILE.STAGE);

    // treliça do palco (como no trailer)
    c.strokeStyle = night ? 'rgba(90,90,100,0.55)' : 'rgba(60,60,64,0.28)';
    c.lineWidth = 0.05;
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] !== TILE.STAGE) continue;
      const x = i % W, y = (i / W) | 0;
      if (x % 2 === 0 && y % 2 === 0) { // treliça: módulos de 2 m com diagonal
        c.strokeRect(x + 0.1, y + 0.1, 1.8, 1.8);
        c.beginPath(); c.moveTo(x + 0.1, y + 0.1); c.lineTo(x + 1.9, y + 1.9); c.stroke();
      }
    }
    for (const l of this.stageLights) {
      c.fillStyle = l.c;
      c.beginPath(); c.arc(l.x, l.y, 0.17, 0, 6.283); c.fill();
    }

    // decoração
    for (const d of w.level.decor || []) {
      if (d.type === 'park') {
        seed = 7;
        for (let k = 0; k < d.w * d.h * 0.45; k++) {
          const px = d.x + 0.5 + rnd() * (d.w - 1), py = d.y + 0.5 + rnd() * (d.h - 1);
          const r = 0.5 + rnd() * 0.4;
          c.fillStyle = 'rgba(0,0,0,0.3)';
          c.beginPath(); c.arc(px + 0.3, py + 0.35, r, 0, 6.283); c.fill();
          c.fillStyle = night ? ['#1c3a1f', '#234526', '#173119'][k % 3] : ['#3f8a3a', '#4f9d42', '#2f7330'][k % 3];
          c.beginPath(); c.arc(px, py, r, 0, 6.283); c.fill();
          c.fillStyle = night ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.12)';
          c.beginPath(); c.arc(px - r * 0.3, py - r * 0.3, r * 0.45, 0, 6.283); c.fill();
        }
      } else if (d.type === 'tent') {
        const cols = ['#e74c3c', '#ffffff'];
        for (let k = 0; k < d.w * 2; k++) {
          c.fillStyle = cols[k % 2];
          c.fillRect(d.x + k * 0.5, d.y, 0.5, d.h);
        }
        c.fillStyle = 'rgba(0,0,0,0.15)'; c.fillRect(d.x, d.y + d.h / 2, d.w, d.h / 2);
      } else if (d.type === 'mixer') {
        c.fillStyle = '#2d2f34'; c.fillRect(d.x + 0.5, d.y + 0.5, d.w - 1, d.h - 1);
        c.fillStyle = '#4cc9f0';
        for (let k = 0; k < 8; k++) c.fillRect(d.x + 1 + k * 0.5, d.y + 1.2, 0.2, 0.2);
      }
    }

    // postes de luz (noite)
    if (night) {
      c.globalCompositeOperation = 'lighter';
      for (let y = 1; y < H - 1; y += 1) for (let x = 1; x < W - 1; x += 1) {
        if (tiles[y * W + x] !== TILE.FLOOR) continue;
        if ((x * 7 + y * 13) % 23 !== 0) continue;
        const nearB = isSolid(w.tileAt(x - 1, y)) || isSolid(w.tileAt(x + 1, y)) || isSolid(w.tileAt(x, y - 1)) || isSolid(w.tileAt(x, y + 1));
        if (!nearB) continue;
        const g = c.createRadialGradient(x + 0.5, y + 0.5, 0, x + 0.5, y + 0.5, 4);
        g.addColorStop(0, 'rgba(255,190,110,0.35)'); g.addColorStop(1, 'rgba(255,190,110,0)');
        c.fillStyle = g; c.fillRect(x - 4, y - 4, 9, 9);
      }
      c.globalCompositeOperation = 'source-over';
    }

    // portões
    for (let i = 0; i < tiles.length; i++) {
      const x = i % W, y = (i / W) | 0;
      if (w.placed[i] === 3) { // passagem aberta pelo jogador
        c.fillStyle = 'rgba(46,204,113,0.35)'; c.fillRect(x, y, 1, 1);
        continue;
      }
      if (tiles[i] !== TILE.GATE) continue;
      c.fillStyle = w.placed[i] ? '#8fd18f' : '#f2c94c';
      c.fillRect(x, y, 1, 1);
      c.fillStyle = 'rgba(0,0,0,0.35)';
      for (let k = 0; k < 3; k++) c.fillRect(x + k / 3, y, 1 / 6, 1);
      if (w.spawn[i]) {
        const cx = x + 0.5, cy = y + 0.5;
        const ix = x === 0 ? 1 : x === W - 1 ? -1 : 0, iy = y === 0 ? 1 : y === H - 1 ? -1 : 0;
        c.fillStyle = '#ffffff';
        c.beginPath();
        c.moveTo(cx + ix * 0.35, cy + iy * 0.35);
        c.lineTo(cx - ix * 0.25 + iy * 0.3, cy - iy * 0.25 + ix * 0.3);
        c.lineTo(cx - ix * 0.25 - iy * 0.3, cy - iy * 0.25 - ix * 0.3);
        c.fill();
      }
    }
    // grades do jogador (barreiras pretas)
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] !== TILE.FENCE) continue;
      const x = i % W, y = (i / W) | 0;
      const cx = x + 0.5, cy = y + 0.5, hw = 0.2;
      c.fillStyle = 'rgba(0,0,0,0.3)';
      c.fillRect(cx - hw + 0.15, cy - hw + 0.15, hw * 2, hw * 2);
      c.fillStyle = night ? '#0d0d0f' : '#2a2a2c';
      c.fillRect(cx - hw, cy - hw, hw * 2, hw * 2);
      const link = (ox, oy) => {
        const t = w.tileAt(x + ox, y + oy);
        return t === TILE.FENCE || t === TILE.WALL || t === TILE.BUILDING || t === TILE.STAGE;
      };
      if (link(1, 0)) c.fillRect(cx, cy - hw, 0.52, hw * 2);
      if (link(-1, 0)) c.fillRect(x, cy - hw, 0.5, hw * 2);
      if (link(0, 1)) c.fillRect(cx - hw, cy, hw * 2, 0.52);
      if (link(0, -1)) c.fillRect(cx - hw, y, hw * 2, 0.5);
      c.fillStyle = '#f2c94c';
      c.fillRect(cx - 0.06, cy - 0.06, 0.12, 0.12);
    }
    this.staticVersion = w.version;
  }

  seatRow(x, y) {
    const p = this.world.level.pitch;
    if (!p) return 0;
    const dx = Math.max(p.x - x - 0.5, 0, x + 0.5 - (p.x + p.w));
    const dy = Math.max(p.y - y - 0.5, 0, y + 0.5 - (p.y + p.h));
    return Math.floor(Math.max(dx, dy));
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

  outlineCells(c, predIdx) {
    const { W, H } = this.world;
    const ok = (x, y) => x >= 0 && y >= 0 && x < W && y < H && predIdx(y * W + x);
    c.beginPath();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!ok(x, y)) continue;
      if (!ok(x, y - 1)) { c.moveTo(x, y); c.lineTo(x + 1, y); }
      if (!ok(x, y + 1)) { c.moveTo(x, y + 1); c.lineTo(x + 1, y + 1); }
      if (!ok(x - 1, y)) { c.moveTo(x, y); c.lineTo(x, y + 1); }
      if (!ok(x + 1, y)) { c.moveTo(x + 1, y); c.lineTo(x + 1, y + 1); }
    }
    c.stroke();
  }

  outline(c, pred) {
    const { W, tiles } = this.world;
    this.outlineCells(c, i => pred(tiles[i], i));
  }

  // ---------------- prévia de fluxo (modo planejamento) ----------------
  rebuildPreview() {
    const w = this.world;
    const lv = w.level;
    this.entryField = this.entryField?.w === w ? this.entryField : new FlowField(w);
    this.exitField = this.exitField?.w === w ? this.exitField : new FlowField(w);
    const stage = w.stageEdgeCells();
    const firstZone = lv.phases.find(p => p.zone !== undefined)?.zone ?? 0;
    this.entryField.compute(stage.length ? stage : w.zoneCells(firstZone));
    this.exitField.compute(w.gateCells());
    this.spawnCells = lv.doors?.length ? lv.doors : w.spawnCells();
    const zc = w.zoneCells(lv.phases[lv.phases.length - 2]?.zone ?? firstZone);
    this.zoneCellsPrev = zc.length ? zc : w.zoneCells(firstZone);
    const hasEntry = this.spawnCells.length > 0 && !lv.doors?.length;
    this.particles = [];
    const n = Math.min(320, 110 + this.spawnCells.length * 8);
    for (let k = 0; k < n; k++) this.particles.push(this.newParticle(hasEntry && k % 3 !== 0, Math.random() * 3));
    // pré-aquece: avança os rastros ~4 s sem desenhar, para a prévia já abrir cheia
    const noop = () => {};
    const fake = { beginPath: noop, moveTo: noop, lineTo: noop, stroke: noop };
    for (let k = 0; k < 80; k++) this.drawPreview(fake, 0.05);
  }

  newParticle(entry, age = 0) {
    const W = this.world.W;
    const pool = entry ? this.spawnCells : (this.zoneCellsPrev.length ? this.zoneCellsPrev : this.spawnCells);
    const cell = pool[(Math.random() * pool.length) | 0] ?? 0;
    return {
      entry, x: (cell % W) + 0.2 + Math.random() * 0.6, y: ((cell / W) | 0) + 0.2 + Math.random() * 0.6,
      trail: [], age, life: 6 + Math.random() * 6, d0: null, lat: (Math.random() - 0.5) * 0.9,
    };
  }

  drawPreview(c, dt) {
    const dir = [0, 0];
    c.lineCap = 'round';
    for (let k = 0; k < this.particles.length; k++) {
      const p = this.particles[k];
      const f = p.entry ? this.entryField : this.exitField;
      const ci = (p.y | 0) * this.world.W + (p.x | 0);
      const dist = f.dist[ci];
      if (p.d0 === null) p.d0 = isFinite(dist) ? Math.max(1, dist) : 1;
      p.age += dt;
      if (!isFinite(dist) || dist < 0.8 || p.age > p.life) { this.particles[k] = this.newParticle(p.entry); continue; }
      f.sample(p.x, p.y, dir);
      p.x += (dir[0] - dir[1] * p.lat) * 7 * dt; p.y += (dir[1] + dir[0] * p.lat) * 7 * dt;
      const tl = p.trail.length;
      if (tl < 4 || Math.hypot(p.x - p.trail[tl - 4], p.y - p.trail[tl - 3]) > 0.35) p.trail.push(p.x, p.y);
      else { p.trail[tl - 2] = p.x; p.trail[tl - 1] = p.y; }
      if (p.trail.length > (p.entry ? 70 : 40)) p.trail.splice(0, 2);
      const prog = 1 - Math.min(1, dist / p.d0);
      c.lineWidth = p.entry ? 0.2 : 0.13;
      for (let j = 2; j < p.trail.length; j += 2) {
        const a = j / p.trail.length;
        if (p.entry) {
          const col = heat(0.25 + prog * 0.6);
          c.strokeStyle = `rgba(${col[0] | 0},${col[1] | 0},${col[2] | 0},${a * 0.75})`;
        } else c.strokeStyle = `rgba(235,245,255,${a * 0.55})`;
        c.beginPath();
        c.moveTo(p.trail[j - 2], p.trail[j - 1]);
        c.lineTo(p.trail[j], p.trail[j + 1]);
        c.stroke();
      }
    }
  }

  // ---------------- quadro ----------------
  frame(sim, opts, dt) {
    const c = this.ctx;
    this.time += dt;
    if (this.world.version !== this.staticVersion) this.drawStatic();
    this.updateCamera(dt, sim, opts.follow);
    const dpr = this.dpr, cam = this.cam;
    const z = cam.z;
    // fundo
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = this.night ? '#07080b' : '#101113';
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    let sx = 0, sy = 0;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 3);
      sx = (Math.random() - 0.5) * this.shake * 6; sy = (Math.random() - 0.5) * this.shake * 6;
    }
    c.setTransform(dpr * z, 0, 0, dpr * z, dpr * (this.vw / 2 - cam.x * z + sx), dpr * (this.vh / 2 - cam.y * z + sy));
    c.imageSmoothingEnabled = z < this.S;
    c.drawImage(this.staticLayer, 0, 0, this.world.W, this.world.H);
    c.imageSmoothingEnabled = true;

    const ph = sim?.phase;
    if (sim && sim.phaseIdx !== this.lastPhase) { this.lastPhase = sim.phaseIdx; this.onPhase(sim); }
    if (!sim && this.lastPhase !== -1) this.lastPhase = -1;

    if (sim) {
      this.drawTrain(c, sim);
      if (opts.heat) this.drawHeat(c, sim);
      this.drawShowFloor(c, sim, ph);
      this.drawPeople(c, sim, opts, ph);
      this.drawAttractor(c, sim);
    }
    this.drawStaff(c, opts);
    this.drawOverpass(c);
    if (sim) {
      this.drawFallEvents(c, sim);
      this.drawConfetti(c, dt);
      this.drawFireworks(c, sim, ph, dt);
    } else {
      if (opts.preview) this.drawPreview(c, dt);
    }
    this.drawHover(c, opts);
    // vinheta (pré-renderizada)
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (this.night && this.quality) {
      if (!this.vignette) {
        const v = this.vignette = document.createElement('canvas');
        v.width = 256; v.height = 256;
        const vc = v.getContext('2d');
        const g = vc.createRadialGradient(128, 128, 60, 128, 128, 182);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,20,0.55)');
        vc.fillStyle = g; vc.fillRect(0, 0, 256, 256);
      }
      c.drawImage(this.vignette, 0, 0, this.canvas.width, this.canvas.height);
    }
  }

  onPhase(sim) {
    const ph = sim.phase;
    if (!ph) return;
    if (ph.kind === 'hold' && ph.show !== 'match') this.spawnConfetti(sim, ph.show === 'countdown' ? 500 : 350);
    if (ph.kind === 'follow') this.spawnConfetti(sim, 250);
  }

  // ---------- trem do metrô ----------
  drawTrain(c, sim) {
    const d = this.world.level.decor?.find(x => x.type === 'train');
    if (!d) return;
    const ph = sim.phase;
    const W = this.world.W;
    let off;
    if (ph && ph.kind === 'burst') {
      const t = sim.phaseTime, arrive = 2, stay = (ph.unload || 4) + 1.5;
      if (t < arrive) off = -W * Math.pow(1 - t / arrive, 2);          // chegando
      else if (t < arrive + stay) off = 0;                             // parado
      else off = W * Math.pow((t - arrive - stay) / 3, 2);             // partindo
    } else return;
    if (off > W) return;
    const y = d.y + 0.35, h = d.h - 0.7;
    c.save();
    c.beginPath(); c.rect(0, d.y, W, d.h); c.clip();
    const carL = 11;
    for (let k = 0; k * carL < W + 2; k++) {
      const x = off + k * carL + 0.6;
      c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(x + 0.2, y + 0.25, carL - 0.8, h);
      c.fillStyle = '#d9dde2'; c.fillRect(x, y, carL - 0.8, h);
      c.fillStyle = '#c0392b'; c.fillRect(x, y + h - 0.35, carL - 0.8, 0.2);
      c.fillStyle = '#9aa3ad';
      for (let s = 1; s < carL - 1; s += 1.4) c.fillRect(x + s, y + 0.4, 0.6, h - 0.8);
    }
    c.restore();
  }

  drawHeat(c, sim) {
    const { W, H } = this.world;
    this.heatTick = (this.heatTick || 0) + 1;
    if (this.heatTick % 2 === 0 && this.heatReady) { this.blitHeat(c); return; }
    this.heatReady = true;
    const img = this.heatImg.data;
    const danger = sim.p.dangerDensity;
    const tiles = this.world.tiles;
    for (let i = 0; i < W * H; i++) {
      const d = sim.density[i];
      const o = i * 4;
      if (d < 0.25 || isSolid(tiles[i])) { img[o + 3] = 0; continue; }
      const col = heat(d / danger);
      img[o] = col[0]; img[o + 1] = col[1]; img[o + 2] = col[2];
      img[o + 3] = Math.min(210, 60 + d * 30);
    }
    this.heatLayer.getContext('2d').putImageData(this.heatImg, 0, 0);
    this.blitHeat(c);
  }

  blitHeat(c) {
    const { W, H } = this.world;
    if (this.night) { c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.75; }
    else c.globalAlpha = 0.55;
    c.drawImage(this.heatLayer, 0, 0, W, H);
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  }

  // ---------- luzes do show no chão ----------
  drawShowFloor(c, sim, ph) {
    if (!ph || !this.stageLights.length) return;
    const showing = ph.kind === 'hold' && (ph.show === 'concert' || ph.show === 'countdown');
    const level = showing ? 1 : ph.kind === 'enter' ? 0.35 : 0;
    if (!level) return;
    const t = this.time;
    c.globalCompositeOperation = 'lighter';
    const surge = sim.surge ? 1.6 : 1;
    const stepK = this.quality ? 2 : 4;
    for (let k = 0; k < this.stageLights.length; k += stepK) {
      const l = this.stageLights[k];
      const ang = Math.atan2(l.dy, l.dx) + Math.sin(t * 1.3 + k) * 0.7;
      const len = 9 + Math.sin(t * 0.9 + k * 1.7) * 3;
      const ex = l.x + Math.cos(ang) * len, ey = l.y + Math.sin(ang) * len;
      c.globalAlpha = Math.min(1, (0.45 + 0.25 * Math.sin(t * 6 + k)) * level * surge);
      c.drawImage(this.glow(l.c), ex - 3.4, ey - 3.4, 6.8, 6.8);
      if (this.quality) { // facho de luz
        c.globalAlpha = 0.28 * level;
        c.fillStyle = l.c;
        const px = -Math.sin(ang), py = Math.cos(ang);
        c.beginPath();
        c.moveTo(l.x + px * 0.15, l.y + py * 0.15);
        c.lineTo(ex + px * 1.8, ey + py * 1.8);
        c.lineTo(ex - px * 1.8, ey - py * 1.8);
        c.lineTo(l.x - px * 0.15, l.y - py * 0.15);
        c.globalAlpha = 0.12 * level;
        c.fill();
      }
    }
    c.globalAlpha = 1;
    for (let k = 0; k < this.stageLights.length; k++) {
      const l = this.stageLights[k];
      if (Math.sin(t * 8 + k * 0.9) <= 0.2) continue;
      c.globalAlpha = level;
      c.drawImage(this.glow(l.c), l.x - 1, l.y - 1, 2, 2);
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }

  // ---------- pessoas ----------
  // Desenho em LOTES: as pessoas são agrupadas por cor (contagem) e cada cor vira um único fill().
  drawPeople(c, sim, opts, ph) {
    const pr = this.cam.z * sim.p.radius;  // raio de uma pessoa em px de CSS
    const danger = sim.p.dangerDensity;
    const N = sim.N;
    const tiles = this.world.tiles, W = this.world.W;
    const showing = ph && (ph.kind === 'hold' || ph.kind === 'follow');
    const tifo = ph?.show === 'match' && ph.kind === 'hold';
    const carnival = !!this.world.level.parade;
    const t = this.time;
    const cam = this.cam;
    const hw = this.vw / 2 / cam.z + 1, hh = this.vh / 2 / cam.z + 1;
    const x0 = cam.x - hw, x1 = cam.x + hw, y0 = cam.y - hh, y1 = cam.y + hh;
    const X = sim.x, Y = sim.y, st = sim.state;

    // 1) índice de cor de cada pessoa visível + contagem por cor
    const P = this.palette;
    if (!this.colIdx || this.colIdx.length < N) { this.colIdx = new Uint8Array(N); this.order = new Int32Array(N); }
    const col = this.colIdx, order = this.order;
    const cnt = this.palCount.fill(0);
    let vis = 0;
    for (let i = 0; i < N; i++) {
      if (st[i] !== STATE.ACTIVE) { col[i] = 255; continue; }
      const x = X[i], y = Y[i];
      if (x < x0 || x > x1 || y < y0 || y > y1) { col[i] = 255; continue; }
      let k;
      if (tifo && tiles[((y | 0) * W) + (x | 0)] === TILE.SEATS) k = P.tifo + this.tifoIdx(x, y, t);
      else if (opts.heat) k = Math.min(HEAT_STEPS - 1, Math.max(0, Math.round(sim.localD[i] / danger * (HEAT_STEPS - 1))));
      else k = carnival ? P.abada + sim.shirt[i] % ABADAS.length : P.shirt + sim.shirt[i] % SHIRTS.length;
      col[i] = k; cnt[k]++; vis++;
    }
    // ordenação por contagem (O(N))
    const start = this.palStart;
    let acc = 0;
    for (let k = 0; k < cnt.length; k++) { start[k] = acc; acc += cnt[k]; }
    const fillPos = this.palFill; fillPos.set(start);
    for (let i = 0; i < N; i++) if (col[i] !== 255) order[fillPos[col[i]]++] = i;

    // 2) longe: quadradinhos
    if (pr < 1.9) {
      const s = Math.max(sim.p.radius * 1.7, 1.4 / cam.z);
      for (let k = 0; k < cnt.length; k++) {
        if (!cnt[k]) continue;
        c.fillStyle = P.css[k];
        for (let n = start[k], e = start[k] + cnt[k]; n < e; n++) { const i = order[n]; c.fillRect(X[i] - s / 2, Y[i] - s / 2, s, s); }
      }
      this.drawFallen(c, sim, x0, x1, y0, y1);
      return;
    }

    const jumpOf = i => (showing ? this.jump(i, sim) : 0);
    // 3) sombras (um fill)
    if (pr > 2.2 && this.quality > 0) {
      c.fillStyle = this.night ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.22)';
      c.beginPath();
      for (let n = 0; n < vis; n++) {
        const i = order[n];
        const j = jumpOf(i), o = 0.07 + j * 0.25, rr = 0.23 * (1 - j * 0.25);
        c.moveTo(X[i] + o + rr, Y[i] + o * 1.2);
        c.arc(X[i] + o, Y[i] + o * 1.2, rr, 0, 6.283);
      }
      c.fill();
    }
    this.drawFallen(c, sim, x0, x1, y0, y1);

    // 4) pés e braços só bem de perto (poucas pessoas na tela)
    const close = pr > 4.5;
    if (close) {
      c.fillStyle = '#222';
      c.beginPath();
      for (let n = 0; n < vis; n++) {
        const i = order[n];
        if (sim.vx[i] * sim.vx[i] + sim.vy[i] * sim.vy[i] < 0.04) continue;
        const h = sim.heading[i], ch = Math.cos(h), sh = Math.sin(h);
        const sw = Math.sin(sim.walk[i]) * 0.13;
        const ax = X[i] + ch * sw - sh * 0.09, ay = Y[i] + sh * sw + ch * 0.09;
        const bx = X[i] - ch * sw + sh * 0.09, by = Y[i] - sh * sw - ch * 0.09;
        c.moveTo(ax + 0.055, ay); c.arc(ax, ay, 0.055, 0, 6.283);
        c.moveTo(bx + 0.055, by); c.arc(bx, by, 0.055, 0, 6.283);
      }
      c.fill();
    }

    // 5) troncos: uma elipse por pessoa, um fill por cor
    for (let k = 0; k < cnt.length; k++) {
      if (!cnt[k]) continue;
      c.fillStyle = P.css[k];
      c.beginPath();
      for (let n = start[k], e = start[k] + cnt[k]; n < e; n++) {
        const i = order[n];
        const sc = 1 + jumpOf(i) * 0.18;
        const h = sim.heading[i];
        c.moveTo(X[i] + Math.cos(h + 1.5708) * 0.24 * sc, Y[i] + Math.sin(h + 1.5708) * 0.24 * sc);
        c.ellipse(X[i], Y[i], 0.13 * sc, 0.24 * sc, h, 1.5708, 1.5708 + 6.283);
      }
      c.fill();
    }

    // 6) braços para cima na euforia
    if (close && showing) {
      c.fillStyle = '#e0ac69';
      c.beginPath();
      for (let n = 0; n < vis; n++) {
        const i = order[n];
        if (!(sim.surge || jumpOf(i) > 0.4)) continue;
        const h = sim.heading[i], ch = Math.cos(h), sh = Math.sin(h);
        const ax = X[i] + ch * 0.12 - sh * 0.2, ay = Y[i] + sh * 0.12 + ch * 0.2;
        const bx = X[i] + ch * 0.12 + sh * 0.2, by = Y[i] + sh * 0.12 - ch * 0.2;
        c.moveTo(ax + 0.05, ay); c.arc(ax, ay, 0.05, 0, 6.283);
        c.moveTo(bx + 0.05, by); c.arc(bx, by, 0.05, 0, 6.283);
      }
      c.fill();
    }

    // 7) cabeças: um fill por cor de cabelo
    if (pr > 1.8) {
      for (let hc = 0; hc < HAIR.length; hc++) {
        c.fillStyle = HAIR[hc];
        c.beginPath();
        for (let n = 0; n < vis; n++) {
          const i = order[n];
          if (sim.shirt[i] % HAIR.length !== hc) continue;
          const rr = 0.1 * (1 + jumpOf(i) * 0.18);
          c.moveTo(X[i] + rr, Y[i]); c.arc(X[i], Y[i], rr, 0, 6.283);
        }
        c.fill();
      }
    }

    // 8) anel de alerta em quem está perto de cair (visível a partir de zoom médio)
    if (pr > 2) {
      const lim = sim.p.stressToFall;
      c.lineWidth = Math.max(0.05, 1.5 / cam.z);
      c.strokeStyle = 'rgba(255,40,40,0.9)';
      c.beginPath();
      for (let n = 0; n < vis; n++) {
        const i = order[n];
        if (sim.stress[i] <= lim * 0.5) continue;
        c.moveTo(X[i] + 0.32, Y[i]); c.arc(X[i], Y[i], 0.32, 0, 6.283);
      }
      c.stroke();
    }
  }

  tifoIdx(x, y, t) {
    const p = this.world.level.pitch;
    const ang = Math.atan2(y - (p.y + p.h / 2), x - (p.x + p.w / 2));
    if (Math.sin(ang * 3 - t * 4) > 0.92) return 2;
    return Math.floor((ang + Math.PI) / (Math.PI / 10) + t * 0.6) % 2;
  }

  jump(i, sim) {
    const base = Math.sin(this.time * 7 + i * 1.7);
    const amp = sim.surge ? 1 : 0.35;
    return Math.max(0, base) * amp;
  }

  drawFallen(c, sim, x0, x1, y0, y1) {
    const z = this.cam.z;
    const near = z * 0.23 > 2;
    const k = Math.max(0.22, 3 / z);
    if (near) {
      c.fillStyle = this.night ? '#55585f' : '#8a8780';
      c.beginPath();
      for (let i = 0; i < sim.N; i++) {
        if (sim.state[i] !== STATE.FALLEN) continue;
        const x = sim.x[i], y = sim.y[i];
        if (x < x0 || x > x1 || y < y0 || y > y1) continue;
        const h = sim.heading[i];
        c.moveTo(x + Math.cos(h) * 0.36, y + Math.sin(h) * 0.36);
        c.ellipse(x, y, 0.36, 0.16, h, 0, 6.283);
      }
      c.fill();
    }
    c.lineWidth = Math.max(0.09, 1.8 / z);
    c.strokeStyle = '#b3121b';
    c.beginPath();
    for (let i = 0; i < sim.N; i++) {
      if (sim.state[i] !== STATE.FALLEN) continue;
      const x = sim.x[i], y = sim.y[i];
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      c.moveTo(x - k, y - k); c.lineTo(x + k, y + k);
      c.moveTo(x + k, y - k); c.lineTo(x - k, y + k);
    }
    c.stroke();
  }

  // ---------- trio elétrico ----------
  drawAttractor(c, sim) {
    const a = sim.attractor;
    if (!a) return;
    const ang = Math.atan2(a.dirY, a.dirX);
    const L = a.r * 2 + 1.5, Wd = 4.2;
    c.save();
    c.translate(a.x, a.y);
    c.rotate(ang);
    c.fillStyle = 'rgba(0,0,0,0.4)'; c.fillRect(-L / 2 + 0.4, -Wd / 2 + 0.5, L, Wd);
    c.fillStyle = '#1b1b1f'; c.fillRect(-L / 2, -Wd / 2, L, Wd);
    // carroceria colorida
    const cols = ['#ff2d7a', '#ffd400', '#00d1ff', '#7cff4f'];
    for (let k = 0; k < 8; k++) { c.fillStyle = cols[k % 4]; c.fillRect(-L / 2 + k * L / 8, -Wd / 2, L / 8, 0.35); c.fillRect(-L / 2 + k * L / 8, Wd / 2 - 0.35, L / 8, 0.35); }
    // cabine
    c.fillStyle = '#e9e9e9'; c.fillRect(L / 2 - 1.3, -Wd / 2 + 0.4, 1.1, Wd - 0.8);
    c.fillStyle = '#5dade2'; c.fillRect(L / 2 - 0.5, -Wd / 2 + 0.6, 0.3, Wd - 1.2);
    // caixas de som
    c.fillStyle = '#333';
    for (let k = 0; k < 4; k++) c.fillRect(-L / 2 + 0.4 + k * 1.1, -0.9, 0.8, 1.8);
    // luzes
    c.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 6; k++) {
      if (Math.sin(this.time * 9 + k * 1.3) <= 0) continue;
      const lx = -L / 2 + 0.6 + k * (L - 2) / 5, ly = (k % 2 ? 1 : -1) * (Wd / 2 - 0.3);
      c.drawImage(this.glow(cols[k % 4]), lx - 1.8, ly - 1.8, 3.6, 3.6);
    }
    c.globalCompositeOperation = 'source-over';
    c.restore();
  }

  // ---------- equipe ----------
  drawStaff(c, opts) {
    const w = this.world;
    const R = w.p.staffRadius;
    for (const s of w.staff) {
      const x = s.x + 0.5, y = s.y + 0.5;
      c.fillStyle = 'rgba(255,214,0,0.07)';
      c.beginPath(); c.arc(x, y, R, 0, 6.283); c.fill();
      c.setLineDash([0.4, 0.4]);
      c.strokeStyle = 'rgba(255,214,0,0.45)'; c.lineWidth = 0.08;
      c.stroke(); c.setLineDash([]);
      c.fillStyle = 'rgba(0,0,0,0.3)';
      c.beginPath(); c.arc(x + 0.08, y + 0.1, 0.3, 0, 6.283); c.fill();
      c.fillStyle = '#ffd600';
      c.beginPath(); c.ellipse(x, y, 0.16, 0.28, 0, 0, 6.283); c.fill();
      c.fillStyle = '#ff6b00'; c.fillRect(x - 0.16, y - 0.03, 0.32, 0.06);
      c.fillStyle = '#222';
      c.beginPath(); c.arc(x, y, 0.11, 0, 6.283); c.fill();
    }
  }

  drawOverpass(c) {
    const d = this.world.level.decor?.find(x => x.type === 'overpass');
    if (!d) return;
    c.fillStyle = this.night ? 'rgba(40,42,48,0.55)' : 'rgba(130,130,126,0.55)';
    c.fillRect(d.x, d.y, d.w, d.h);
    c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 0.12;
    c.strokeRect(d.x, d.y, d.w, d.h);
    c.fillStyle = 'rgba(255,255,255,0.5)';
    for (let x = d.x + 1; x < d.x + d.w; x += 3) c.fillRect(x, d.y + d.h / 2 - 0.05, 1.5, 0.1);
  }

  drawFallEvents(c, sim) {
    for (const e of sim.events) {
      const age = sim.time - e.t;
      if (age > 1.4) continue;
      c.strokeStyle = `rgba(255,40,40,${1 - age / 1.4})`;
      c.lineWidth = 0.15;
      c.beginPath(); c.arc(e.x, e.y, 0.4 + age * 2.5, 0, 6.283); c.stroke();
    }
  }

  // ---------- confete ----------
  spawnConfetti(sim, n) {
    const w = this.world;
    if (!this.quality) n = Math.floor(n / 3);
    let cells = [];
    const ph = sim.phase;
    if (ph.zone !== undefined) cells = w.zoneCells(ph.zone);
    const cols = ['#ff4d6d', '#ffd166', '#06d6a0', '#4cc9f0', '#c77dff', '#ffffff'];
    for (let k = 0; k < n; k++) {
      let x, y;
      if (sim.attractor) { x = sim.attractor.x + (Math.random() - 0.5) * 16; y = sim.attractor.y + (Math.random() - 0.5) * 16; }
      else if (cells.length) { const cc = cells[(Math.random() * cells.length) | 0]; x = cc % w.W + Math.random(); y = ((cc / w.W) | 0) + Math.random(); }
      else continue;
      this.confetti.push({ x, y, h: 3 + Math.random() * 5, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 8, c: cols[k % cols.length], life: 9 + Math.random() * 4 });
    }
  }

  drawConfetti(c, dt) {
    if (!this.confetti.length) return;
    const keep = [];
    for (const p of this.confetti) {
      p.life -= dt;
      if (p.life <= 0) continue;
      if (p.h > 0) { p.h = Math.max(0, p.h - dt * 1.2); p.rot += p.vr * dt; p.x += Math.sin(p.rot) * dt * 0.6; }
      const a = Math.min(1, p.life / 2);
      c.globalAlpha = a;
      c.fillStyle = p.c;
      const s = 0.16 + p.h * 0.03;
      c.save(); c.translate(p.x - p.h * 0.15, p.y - p.h * 0.3); c.rotate(p.rot);
      c.fillRect(-s / 2, -s / 4, s, s / 2 * Math.abs(Math.cos(p.rot * 2)) + 0.03);
      c.restore();
      keep.push(p);
    }
    c.globalAlpha = 1;
    this.confetti = keep;
  }

  // ---------- fogos de artifício (réveillon) ----------
  drawFireworks(c, sim, ph, dt) {
    const countdownEnd = ph && ph.kind === 'hold' && ph.show === 'countdown' && sim.phaseTime > ph.duration - 4;
    const newYear = ph && ph.kind === 'exit' && this.world.level.night && sim.phaseTime < 10;
    if ((countdownEnd || newYear) && Math.random() < dt * (newYear ? 5 : 2)) {
      const f = this.focusPoint();
      this.rockets.push({ x: f.x + (Math.random() - 0.5) * 30, y: f.y + 12 + Math.random() * 6, ty: f.y - 6 + (Math.random() - 0.5) * 16, c: LIGHTS[(Math.random() * LIGHTS.length) | 0] });
    }
    c.globalCompositeOperation = 'lighter';
    const rk = [];
    for (const r of this.rockets) {
      r.y -= dt * 18;
      c.fillStyle = '#fff8e0'; c.beginPath(); c.arc(r.x, r.y, 0.2, 0, 6.283); c.fill();
      if (r.y <= r.ty) {
        for (let k = 0; k < 50; k++) {
          const a = Math.random() * 6.283, v = 4 + Math.random() * 7;
          this.sparks.push({ x: r.x, y: r.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1.2 + Math.random() * 0.8, c: r.c });
        }
        this.flash = 0.25;
      } else rk.push(r);
    }
    this.rockets = rk;
    const sp = [];
    for (const s of this.sparks) {
      s.life -= dt; if (s.life <= 0) continue;
      s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= 0.96; s.vy *= 0.96;
      const g = Math.min(1, s.life);
      c.fillStyle = hexA(s.c, g);
      c.beginPath(); c.arc(s.x, s.y, 0.22 * g + 0.06, 0, 6.283); c.fill();
      sp.push(s);
    }
    this.sparks = sp;
    c.globalCompositeOperation = 'source-over';
    if (this.flash > 0) {
      this.flash -= dt;
      c.fillStyle = `rgba(255,240,220,${Math.max(0, this.flash) * 0.25})`;
      c.fillRect(0, 0, this.world.W, this.world.H);
    }
  }

  drawHover(c, opts) {
    const lw = Math.max(0.06, 2 / this.cam.z);
    // prévia do traço (construção em linha)
    const g = this.ghost;
    if (g) {
      const pulse = 0.55 + 0.25 * Math.sin(this.time * 8);
      for (const { x, y, ok } of g.cells) {
        if (!this.world.inside(x, y)) continue;
        c.fillStyle = ok ? (g.tool === 'erase' ? `rgba(231,76,60,${pulse * 0.6})` : `rgba(46,204,113,${pulse * 0.55})`) : 'rgba(231,76,60,0.25)';
        c.fillRect(x + 0.04, y + 0.04, 0.92, 0.92);
        if (ok && g.tool === 'fence') { c.fillStyle = 'rgba(20,20,20,0.85)'; c.fillRect(x + 0.3, y + 0.3, 0.4, 0.4); }
        if (!ok) {
          c.strokeStyle = 'rgba(231,76,60,0.9)'; c.lineWidth = lw;
          c.beginPath(); c.moveTo(x + 0.25, y + 0.25); c.lineTo(x + 0.75, y + 0.75); c.moveTo(x + 0.75, y + 0.25); c.lineTo(x + 0.25, y + 0.75); c.stroke();
        }
      }
      if (g.tool === 'staff' && g.cells[0]) {
        const { x, y, ok } = g.cells[0];
        c.setLineDash([0.4, 0.4]);
        c.strokeStyle = ok ? 'rgba(255,214,0,0.9)' : 'rgba(231,76,60,0.8)'; c.lineWidth = lw;
        c.beginPath(); c.arc(x + 0.5, y + 0.5, this.world.p.staffRadius, 0, 6.283); c.stroke();
        c.setLineDash([]);
      }
      return;
    }
    const h = this.hover;
    const tool = opts.tool;
    if (!h || !tool || tool === 'pan' || !this.world.inside(h.x, h.y)) return;
    const ok = this.world.canPlace(tool, h.x, h.y);
    c.strokeStyle = ok ? '#2ecc71' : '#e74c3c';
    c.lineWidth = lw;
    c.strokeRect(h.x + 0.05, h.y + 0.05, 0.9, 0.9);
    if (tool === 'staff' && ok) {
      c.setLineDash([0.4, 0.4]);
      c.strokeStyle = 'rgba(255,214,0,0.7)';
      c.beginPath(); c.arc(h.x + 0.5, h.y + 0.5, this.world.p.staffRadius, 0, 6.283); c.stroke();
      c.setLineDash([]);
    }
  }
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}
