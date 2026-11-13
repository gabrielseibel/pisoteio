// =============================================================
// PISOTEIO — núcleo da simulação (sem DOM, roda no navegador e no Node)
// Unidades: 1 célula = 1 metro; tempo em segundos.
// =============================================================

export const TILE = {
  FLOOR: 0,
  WALL: 1,      // muro do perímetro (pode virar portão com a ferramenta)
  BUILDING: 2,  // prédio, barraca, mesa de som — obstáculo fixo
  STAGE: 3,     // palco
  FENCE: 4,     // grade colocada pelo jogador
  GATE: 5,      // portão (entrada e/ou saída)
};

export const PARAMS = {
  radius: 0.23,          // raio de uma pessoa (m)
  bodyRadius: 0.32,      // raio de uma pessoa caída
  speed: 1.3,            // velocidade de caminhada (m/s)
  speedVar: 0.25,
  relax: 0.45,           // tempo para atingir a velocidade desejada (s)
  pushK: 0.8,            // rigidez do empurra-empurra (0..1). <1 permite compressão
  dangerDensity: 5.2,    // pessoas/m² a partir do qual o corpo sofre
  stressToFall: 1.6,     // estresse acumulado até cair
  stressRecover: 0.6,    // recuperação por segundo quando a pressão alivia
  congestionCost: 0.45,  // quanto a densidade encarece uma rota (pessoas desviam)
  fieldRefresh: 1.0,     // recálculo das rotas (s)
  standDensity: 3.0,     // na plateia, a pessoa para de avançar acima dessa densidade
  jamDensity: 4.6,       // densidade em que a pessoa quase para de andar
  exitUrgency: 1.6,      // na evacuação as pessoas empurram mais
  spawnMaxDensity: 2.6,  // não entra mais gente se o portão estiver lotado
};

const SQ2 = Math.SQRT2;

export function isSolid(t) {
  return t === TILE.WALL || t === TILE.BUILDING || t === TILE.STAGE || t === TILE.FENCE;
}

// ---------------- Mapa ----------------
export class World {
  constructor(level) {
    this.level = level;
    this.W = level.W;
    this.H = level.H;
    const n = this.W * this.H;
    this.tiles = new Uint8Array(level.tiles);
    this.zone = new Int8Array(level.zone);          // -1 = sem zona; 0,1... = plateias
    this.spawn = new Uint8Array(level.spawn);       // 1 = portão por onde o público entra
    this.placed = new Uint8Array(n);                // 1 = colocado pelo jogador
    this.p = { ...PARAMS, ...(level.params || {}) };
    this.money = level.budget;
  }

  idx(x, y) { return y * this.W + x; }
  inside(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }
  tileAt(x, y) { return this.inside(x, y) ? this.tiles[this.idx(x, y)] : TILE.WALL; }
  isBorder(x, y) { return x === 0 || y === 0 || x === this.W - 1 || y === this.H - 1; }

  // ---------- Ferramentas do jogador ----------
  canPlace(tool, x, y) {
    if (!this.inside(x, y)) return false;
    const i = this.idx(x, y);
    const t = this.tiles[i];
    if (tool === 'fence') return t === TILE.FLOOR && this.money >= this.level.costs.fence;
    if (tool === 'gate') {
      if (!(t === TILE.WALL && this.isBorder(x, y))) return false;
      if (this.money < this.level.costs.gate) return false;
      // precisa ter chão do lado de dentro
      const nx = x === 0 ? 1 : x === this.W - 1 ? this.W - 2 : x;
      const ny = y === 0 ? 1 : y === this.H - 1 ? this.H - 2 : y;
      const inner = this.tileAt(nx, ny);
      return inner === TILE.FLOOR || inner === TILE.GATE;
    }
    if (tool === 'erase') return this.placed[i] === 1;
    return false;
  }

  place(tool, x, y) {
    if (!this.canPlace(tool, x, y)) return false;
    const i = this.idx(x, y);
    if (tool === 'fence') {
      this.tiles[i] = TILE.FENCE; this.placed[i] = 1; this.money -= this.level.costs.fence;
    } else if (tool === 'gate') {
      this.tiles[i] = TILE.GATE; this.placed[i] = 1; this.money -= this.level.costs.gate;
    } else if (tool === 'erase') {
      const t = this.tiles[i];
      if (t === TILE.FENCE) { this.tiles[i] = TILE.FLOOR; this.money += this.level.costs.fence; }
      if (t === TILE.GATE) { this.tiles[i] = TILE.WALL; this.money += this.level.costs.gate; }
      this.placed[i] = 0;
    }
    return true;
  }

  cellsWhere(pred) {
    const out = [];
    for (let i = 0; i < this.tiles.length; i++) if (pred(i)) out.push(i);
    return out;
  }
  zoneCells(z) { return this.cellsWhere(i => this.zone[i] === z && !isSolid(this.tiles[i])); }
  gateCells() { return this.cellsWhere(i => this.tiles[i] === TILE.GATE); }
  spawnCells() { return this.cellsWhere(i => this.tiles[i] === TILE.GATE && this.spawn[i]); }
  stageEdgeCells() {
    return this.cellsWhere(i => {
      if (isSolid(this.tiles[i])) return false;
      const x = i % this.W, y = (i / this.W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (this.tileAt(x + dx, y + dy) === TILE.STAGE) return true;
      }
      return false;
    });
  }
}

// ---------------- Campo de fluxo (Dijkstra) ----------------
// Para cada célula: distância até o alvo e direção para o vizinho mais próximo do alvo.
export class FlowField {
  constructor(world) {
    this.w = world;
    const n = world.W * world.H;
    this.dist = new Float32Array(n);
    this.dx = new Float32Array(n);
    this.dy = new Float32Array(n);
    this.heap = new MinHeap(n * 4);
  }

  compute(targets, density = null, congestion = 0) {
    const { W, H, tiles } = this.w;
    const dist = this.dist;
    dist.fill(Infinity);
    const heap = this.heap; heap.clear();
    for (const i of targets) { dist[i] = 0; heap.push(i, 0); }
    while (heap.size) {
      const [i, d] = heap.pop();
      if (d > dist[i]) continue;
      const x = i % W, y = (i / W) | 0;
      for (let k = 0; k < 8; k++) {
        const ox = NX[k], oy = NY[k];
        const nx = x + ox, ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (isSolid(tiles[j])) continue;
        if (ox && oy && (isSolid(tiles[y * W + nx]) || isSolid(tiles[ny * W + x]))) continue;
        let c = ox && oy ? SQ2 : 1;
        if (density) c *= 1 + congestion * density[j];
        const nd = d + c;
        if (nd < dist[j]) { dist[j] = nd; heap.push(j, nd); }
      }
    }
    // direções
    for (let i = 0; i < dist.length; i++) {
      this.dx[i] = 0; this.dy[i] = 0;
      if (!isFinite(dist[i]) || dist[i] === 0) continue;
      const x = i % W, y = (i / W) | 0;
      let best = dist[i], bx = 0, by = 0;
      for (let k = 0; k < 8; k++) {
        const ox = NX[k], oy = NY[k];
        const nx = x + ox, ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (isSolid(tiles[j])) continue;
        if (ox && oy && (isSolid(tiles[y * W + nx]) || isSolid(tiles[ny * W + x]))) continue;
        if (dist[j] < best) { best = dist[j]; bx = ox; by = oy; }
      }
      const l = Math.hypot(bx, by) || 1;
      this.dx[i] = bx / l; this.dy[i] = by / l;
    }
  }

  // direção suavizada (interpolação bilinear entre células vizinhas)
  sample(px, py, out) {
    const { W, H } = this.w;
    const fx = px - 0.5, fy = py - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    let sx = 0, sy = 0, sw = 0;
    for (let k = 0; k < 4; k++) {
      const cx = x0 + (k & 1), cy = y0 + (k >> 1);
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
      const i = cy * W + cx;
      if (!isFinite(this.dist[i])) continue;
      const wgt = ((k & 1) ? tx : 1 - tx) * ((k >> 1) ? ty : 1 - ty);
      sx += this.dx[i] * wgt; sy += this.dy[i] * wgt; sw += wgt;
    }
    const ci = clampI(Math.floor(py), 0, H - 1) * W + clampI(Math.floor(px), 0, W - 1);
    if (sw < 1e-4) { out[0] = this.dx[ci]; out[1] = this.dy[ci]; return; }
    const l = Math.hypot(sx, sy);
    if (l < 1e-4) { out[0] = this.dx[ci]; out[1] = this.dy[ci]; return; }
    out[0] = sx / l; out[1] = sy / l;
  }
}

const NX = [1, -1, 0, 0, 1, 1, -1, -1];
const NY = [0, 0, 1, -1, 1, -1, 1, -1];
const clampI = (v, a, b) => (v < a ? a : v > b ? b : v);

class MinHeap {
  constructor(cap) { this.k = new Int32Array(cap); this.v = new Float32Array(cap); this.size = 0; }
  clear() { this.size = 0; }
  push(key, val) {
    if (this.size >= this.k.length) { // cresce se precisar
      const k2 = new Int32Array(this.k.length * 2); k2.set(this.k); this.k = k2;
      const v2 = new Float32Array(this.v.length * 2); v2.set(this.v); this.v = v2;
    }
    let i = this.size++;
    this.k[i] = key; this.v[i] = val;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.v[p] <= this.v[i]) break;
      this.swap(i, p); i = p;
    }
  }
  pop() {
    const key = this.k[0], val = this.v[0];
    this.size--;
    if (this.size > 0) {
      this.k[0] = this.k[this.size]; this.v[0] = this.v[this.size];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.size && this.v[l] < this.v[m]) m = l;
        if (r < this.size && this.v[r] < this.v[m]) m = r;
        if (m === i) break;
        this.swap(i, m); i = m;
      }
    }
    return [key, val];
  }
  swap(a, b) {
    const tk = this.k[a]; this.k[a] = this.k[b]; this.k[b] = tk;
    const tv = this.v[a]; this.v[a] = this.v[b]; this.v[b] = tv;
  }
}

// ---------------- Simulação ----------------
export const STATE = { ACTIVE: 0, FALLEN: 1, GONE: 2 };

export class Simulation {
  constructor(world, seed = 1) {
    this.w = world;
    this.p = world.p;
    this.rng = mulberry32(seed);
    const lv = world.level;
    const N = lv.crowd;
    this.N = N;
    this.x = new Float32Array(N); this.y = new Float32Array(N);
    this.vx = new Float32Array(N); this.vy = new Float32Array(N);
    this.v0 = new Float32Array(N);
    this.stress = new Float32Array(N);
    this.state = new Uint8Array(N).fill(STATE.GONE);
    this.hue = new Float32Array(N);
    this.localD = new Float32Array(N);
    this.spawned = 0; this.exited = 0; this.trampled = 0;
    this.events = [];   // {x,y,t} para efeitos visuais de queda
    this.time = 0;

    const n = world.W * world.H;
    this.count = new Float32Array(n);
    this.density = new Float32Array(n);
    this.head = new Int32Array(n);
    this.next = new Int32Array(N);
    this.peakDensity = 0;

    this.field = new FlowField(world);
    this.stageField = new FlowField(world);
    this.stageField.compute(world.stageEdgeCells());
    this.spawnCells = world.spawnCells();
    this.spawnAcc = new Float32Array(this.spawnCells.length);

    this.phases = lv.phases;
    this.phaseIdx = -1;
    this.done = false;
    this.nextPhase();
  }

  get phase() { return this.phases[this.phaseIdx]; }
  get active() { let c = 0; for (let i = 0; i < this.N; i++) if (this.state[i] === STATE.ACTIVE) c++; return c; }

  nextPhase() {
    this.phaseIdx++;
    this.phaseTime = 0;
    if (this.phaseIdx >= this.phases.length) { this.done = true; return; }
    this.refreshField();
    this.fieldTimer = 0;
  }

  targetCells() {
    const ph = this.phase;
    if (ph.kind === 'exit') return this.w.gateCells();
    return this.w.zoneCells(ph.zone);
  }

  refreshField() {
    this.field.compute(this.targetCells(), this.density, this.p.congestionCost);
  }

  spawnOne(cellIdx) {
    {
      if (this.spawned >= this.N) return false;
      const i = this.spawned;
      const W = this.w.W;
      const cx = cellIdx % W, cy = (cellIdx / W) | 0;
      this.x[i] = cx + 0.2 + this.rng() * 0.6;
      this.y[i] = cy + 0.2 + this.rng() * 0.6;
      this.vx[i] = 0; this.vy[i] = 0;
      this.v0[i] = this.p.speed + (this.rng() * 2 - 1) * this.p.speedVar;
      this.stress[i] = 0;
      this.state[i] = STATE.ACTIVE;
      this.hue[i] = this.rng() * 360;
      this.spawned++;
      return true;
    }
    return false;
  }

  step(dt) {
    if (this.done) return;
    const w = this.w, p = this.p, W = w.W, H = w.H;
    const N = this.N;
    this.time += dt; this.phaseTime += dt; this.fieldTimer += dt;
    const ph = this.phase;

    // ---- entrada do público
    if (ph.kind === 'enter' && this.spawned < N) {
      const rate = (this.w.level.spawnRate || 6) / Math.max(1, this.spawnCells.length / 2);
      for (let s = 0; s < this.spawnCells.length; s++) {
        this.spawnAcc[s] += rate * dt;
        const c = this.spawnCells[s];
        while (this.spawnAcc[s] >= 1 && this.spawned < N) {
          if (this.density[c] > p.spawnMaxDensity) { this.spawnAcc[s] = Math.min(this.spawnAcc[s], 2); break; }
          this.spawnAcc[s] -= 1;
          this.spawnOne(c);
        }
      }
    }

    // ---- grade espacial + densidade
    this.buildGrid();

    if (this.fieldTimer >= p.fieldRefresh) { this.fieldTimer = 0; this.refreshField(); }

    // ---- vontade de cada pessoa
    const dir = [0, 0];
    const relax = Math.min(1, dt / p.relax);
    const isExit = ph.kind === 'exit';
    const zoneId = ph.zone;
    const excitement = ph.excitement ?? 1;
    for (let i = 0; i < N; i++) {
      if (this.state[i] !== STATE.ACTIVE) continue;
      const cx = clampI(this.x[i] | 0, 0, W - 1), cy = clampI(this.y[i] | 0, 0, H - 1);
      const ci = cy * W + cx;
      const d = this.density[ci];
      this.localD[i] = d;
      let tx = 0, ty = 0, sp = this.v0[i];
      if (!isExit && w.zone[ci] === zoneId) {
        // já está na plateia: avança rumo ao palco enquanto houver espaço
        const stand = p.standDensity * excitement;
        if (d < stand) {
          this.stageField.sample(this.x[i], this.y[i], dir);
          tx = dir[0]; ty = dir[1]; sp *= 0.4 * excitement;
        } else { sp = 0; }
      } else {
        this.field.sample(this.x[i], this.y[i], dir);
        tx = dir[0]; ty = dir[1];
        if (isExit) sp *= 1.15; // pressa para sair
      }
      // diagrama fundamental: quanto mais gente na frente, mais devagar.
      // "urgency" alto (pressa, euforia) faz a pessoa empurrar mesmo no aperto.
      const ahead = this.densityAt(this.x[i] + tx * 0.8, this.y[i] + ty * 0.8);
      const urg = isExit ? p.exitUrgency : 1 + (excitement - 1) * 0.5;
      const jam = p.jamDensity * urg;
      sp *= Math.max(0.08, 1 - ahead / jam);
      // ruído leve
      tx += (this.rng() - 0.5) * 0.15; ty += (this.rng() - 0.5) * 0.15;
      this.vx[i] += (tx * sp - this.vx[i]) * relax;
      this.vy[i] += (ty * sp - this.vy[i]) * relax;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
    }

    // ---- empurra-empurra (dinâmica baseada em posição, "macia")
    for (let it = 0; it < 3; it++) { this.buildGrid(false); this.resolveContacts(); }
    this.resolveWalls();
    this.buildGrid();

    // ---- pressão, quedas e saídas
    for (let i = 0; i < N; i++) {
      if (this.state[i] !== STATE.ACTIVE) continue;
      const cx = clampI(this.x[i] | 0, 0, W - 1), cy = clampI(this.y[i] | 0, 0, H - 1);
      const ci = cy * W + cx;
      const d = this.densityAt(this.x[i], this.y[i]);
      this.localD[i] = d;
      if (d > this.peakDensity) this.peakDensity = d;
      if (d > p.dangerDensity) this.stress[i] += (d - p.dangerDensity) * dt;
      else this.stress[i] = Math.max(0, this.stress[i] - p.stressRecover * dt);
      if (this.stress[i] > p.stressToFall) {
        this.state[i] = STATE.FALLEN; this.vx[i] = 0; this.vy[i] = 0;
        this.trampled++;
        this.events.push({ x: this.x[i], y: this.y[i], t: this.time });
        continue;
      }
      if (isExit && w.tiles[ci] === TILE.GATE) {
        this.state[i] = STATE.GONE; this.exited++;
      }
    }

    // ---- avanço das fases
    const act = this.active;
    if (ph.kind === 'enter' || ph.kind === 'move') {
      let inZone = 0;
      for (let i = 0; i < N; i++) {
        if (this.state[i] !== STATE.ACTIVE) continue;
        const ci = clampI(this.y[i] | 0, 0, H - 1) * W + clampI(this.x[i] | 0, 0, W - 1);
        if (w.zone[ci] === ph.zone) inZone++;
      }
      this.inZone = inZone;
      const allIn = (ph.kind === 'move' || this.spawned >= N) && inZone >= act * 0.92;
      if (allIn || this.phaseTime > (ph.maxTime || 120)) this.nextPhase();
    } else if (ph.kind === 'hold') {
      if (this.phaseTime >= ph.duration) this.nextPhase();
    } else if (ph.kind === 'exit') {
      // termina quando todos saíram, ou se ninguém sai há 20 s (alguém preso num canto)
      if (this.exited !== this.lastExited) { this.lastExited = this.exited; this.stallTime = 0; }
      else if (this.exited > 0) this.stallTime = (this.stallTime || 0) + dt;
      if (act === 0 || this.stallTime > 20 || this.phaseTime > (ph.maxTime || 240)) this.nextPhase();
    }
  }

  buildGrid(withDensity = true) {
    const W = this.w.W, H = this.w.H;
    this.head.fill(-1);
    if (withDensity) this.count.fill(0);
    for (let i = 0; i < this.N; i++) {
      const s = this.state[i];
      if (s === STATE.GONE) continue;
      const cx = clampI(this.x[i] | 0, 0, W - 1), cy = clampI(this.y[i] | 0, 0, H - 1);
      const c = cy * W + cx;
      this.next[i] = this.head[c]; this.head[c] = i;
      if (withDensity) this.count[c] += s === STATE.FALLEN ? 1.6 : 1; // corpo no chão ocupa mais
    }
    if (!withDensity) return;
    // suavização 3x3 → pessoas por m² (só células livres contam como área)
    const cnt = this.count, den = this.density, tiles = this.w.tiles;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, a = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const nx = x + ox, ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        const wgt = (ox === 0 ? 2 : 1) * (oy === 0 ? 2 : 1);
        if (!isSolid(tiles[j])) a += wgt;
        s += cnt[j] * wgt;
      }
      den[y * W + x] = a > 0 ? s / a : 0;
    }
  }

  densityAt(px, py) {
    const W = this.w.W, H = this.w.H;
    const fx = px - 0.5, fy = py - 0.5;
    const x0 = clampI(Math.floor(fx), 0, W - 1), y0 = clampI(Math.floor(fy), 0, H - 1);
    const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
    const tx = Math.min(1, Math.max(0, fx - x0)), ty = Math.min(1, Math.max(0, fy - y0));
    const d = this.density;
    return (d[y0 * W + x0] * (1 - tx) + d[y0 * W + x1] * tx) * (1 - ty) +
           (d[y1 * W + x0] * (1 - tx) + d[y1 * W + x1] * tx) * ty;
  }

  resolveContacts() {
    const W = this.w.W, H = this.w.H, p = this.p;
    const r = p.radius, rb = p.bodyRadius, k = p.pushK * 0.5;
    for (let i = 0; i < this.N; i++) {
      if (this.state[i] !== STATE.ACTIVE) continue;
      const cx = this.x[i] | 0, cy = this.y[i] | 0;
      for (let oy = -1; oy <= 1; oy++) {
        const ny = cy + oy; if (ny < 0 || ny >= H) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const nx = cx + ox; if (nx < 0 || nx >= W) continue;
          let j = this.head[ny * W + nx];
          while (j !== -1) {
            if (j !== i && (this.state[j] === STATE.FALLEN || j > i)) {
              const fallen = this.state[j] === STATE.FALLEN;
              const rr = fallen ? r + rb : 2 * r;
              let dx = this.x[i] - this.x[j], dy = this.y[i] - this.y[j];
              let d2 = dx * dx + dy * dy;
              if (d2 < rr * rr) {
                if (d2 < 1e-8) { dx = this.rng() - 0.5; dy = this.rng() - 0.5; d2 = dx * dx + dy * dy; }
                const d = Math.sqrt(d2);
                const ov = (rr - d) / d;
                if (fallen) { // corpo no chão: tropeça e é empurrado
                  this.x[i] += dx * ov * 0.5; this.y[i] += dy * ov * 0.5;
                } else {
                  this.x[i] += dx * ov * k; this.y[i] += dy * ov * k;
                  this.x[j] -= dx * ov * k; this.y[j] -= dy * ov * k;
                }
              }
            }
            j = this.next[j];
          }
        }
      }
    }
  }

  resolveWalls() {
    const w = this.w, r = this.p.radius;
    for (let i = 0; i < this.N; i++) {
      if (this.state[i] !== STATE.ACTIVE) continue;
      for (let pass = 0; pass < 2; pass++) {
        const cx = this.x[i] | 0, cy = this.y[i] | 0;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const nx = cx + ox, ny = cy + oy;
          if (!isSolid(w.tileAt(nx, ny))) continue;
          const qx = Math.max(nx, Math.min(this.x[i], nx + 1));
          const qy = Math.max(ny, Math.min(this.y[i], ny + 1));
          let dx = this.x[i] - qx, dy = this.y[i] - qy;
          const d2 = dx * dx + dy * dy;
          if (d2 < r * r) {
            if (d2 < 1e-10) { // dentro do bloco: empurra para o centro da célula atual
              this.x[i] = cx + 0.5; this.y[i] = cy + 0.5; continue;
            }
            const d = Math.sqrt(d2);
            this.x[i] += dx / d * (r - d); this.y[i] += dy / d * (r - d);
          }
        }
      }
      this.x[i] = Math.max(r, Math.min(w.W - r, this.x[i]));
      this.y[i] = Math.max(r, Math.min(w.H - r, this.y[i]));
    }
  }

  result() {
    const lv = this.w.level;
    const t = this.trampled;
    const stars = t === 0 ? 3 : t <= Math.ceil(lv.maxTrampled / 2) ? 2 : t <= lv.maxTrampled ? 1 : 0;
    return { trampled: t, exited: this.exited, stars, passed: stars > 0, time: this.time, peak: this.peakDensity };
  }
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
