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
  SEATS: 6,     // arquibancada: dá para andar, mas devagar
  GRASS: 7,     // gramado/parque: um pouco mais lento
  PITCH: 8,     // campo de futebol (isolado)
  TRACK: 9,     // trilho do metrô (isolado)
  STAIRS: 10,   // escada: mais lenta
};

export const PARAMS = {
  radius: 0.23,          // raio de uma pessoa (m)
  bodyRadius: 0.32,      // raio de uma pessoa caída
  speed: 1.3,            // velocidade de caminhada (m/s)
  speedVar: 0.25,
  relax: 0.45,           // tempo para atingir a velocidade desejada (s)
  contactIters: 2,       // rodadas de empurra-empurra por passo
  pushK: 0.9,            // rigidez do empurra-empurra (0..1). <1 permite compressão
  dangerDensity: 5.2,    // pessoas/m² a partir do qual o corpo sofre
  stressToFall: 1.6,     // estresse acumulado até cair
  stressRecover: 0.6,    // recuperação por segundo quando a pressão alivia
  congestionCost: 0.45,  // quanto a densidade encarece uma rota (pessoas desviam)
  fieldRefresh: 1.0,     // recálculo das rotas (s)
  standDensity: 3.0,     // na plateia, a pessoa para de avançar acima dessa densidade
  jamDensity: 4.6,       // densidade em que a pessoa quase para de andar
  exitUrgency: 1.6,      // na evacuação as pessoas empurram mais
  spawnMaxDensity: 2.6,  // não entra mais gente se o portão estiver lotado
  panicRadius: 4.5,      // raio (m) em que uma queda assusta quem está perto
  panicGain: 0.6,        // susto causado por uma queda
  panicDecay: 0.22,      // o pânico some aos poucos (por segundo)
  panicPush: 0.35,       // quanto o pânico aumenta o empurra-empurra
  staffRadius: 5,        // alcance de um segurança/orientador (m)
  staffCalm: 0.45,       // redução do estresse e da euforia perto da equipe
  surgeEvery: 7,         // a cada X s de show, um "drop" empurra a plateia ao palco
  surgeLength: 2.2,
  surgeBoost: 0.4,
};

const SQ2 = Math.SQRT2;

export function isSolid(t) {
  return t === TILE.WALL || t === TILE.BUILDING || t === TILE.STAGE || t === TILE.FENCE ||
    t === TILE.PITCH || t === TILE.TRACK;
}
// custo de rota e velocidade em cada tipo de piso
export function tileCost(t) { return t === TILE.SEATS ? 2.4 : t === TILE.STAIRS ? 1.6 : t === TILE.GRASS ? 1.15 : 1; }
export function tileSpeed(t) { return t === TILE.SEATS ? 0.42 : t === TILE.STAIRS ? 0.62 : t === TILE.GRASS ? 0.85 : 1; }

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
    this.placed = new Uint8Array(n);                // 1 = colocado pelo jogador (2 = grade sobre grama, 3 = passagem aberta)
    this.openable = new Uint8Array(level.openable || n); // paredes internas que o jogador pode abrir
    this.staff = [];                                // seguranças/orientadores {x,y}
    this.calm = new Float32Array(n);                // 0..1, influência da equipe
    this.p = { ...PARAMS, ...(level.params || {}) };
    this.money = level.budget;
    this.costMult = 1;                              // 2× durante o evento (obra de emergência)
    this.version = 0;                               // muda a cada edição
  }

  idx(x, y) { return y * this.W + x; }
  inside(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }
  tileAt(x, y) { return this.inside(x, y) ? this.tiles[this.idx(x, y)] : TILE.WALL; }
  isBorder(x, y) { return x === 0 || y === 0 || x === this.W - 1 || y === this.H - 1; }
  cost(tool) { return Math.round((this.level.costs[tool] ?? 0) * this.costMult); }
  staffAt(x, y) { return this.staff.findIndex(s => s.x === x && s.y === y); }

  // ---------- Ferramentas do jogador ----------
  canPlace(tool, x, y) {
    if (!this.inside(x, y)) return false;
    const i = this.idx(x, y);
    const t = this.tiles[i];
    const lv = this.level;
    if (lv.tools && !lv.tools.includes(tool) && tool !== 'erase') return false;
    if (tool === 'fence') return (t === TILE.FLOOR || t === TILE.GRASS) && this.placed[i] !== 3 && this.staffAt(x, y) < 0 && this.money >= this.cost('fence');
    if (tool === 'staff') {
      return !isSolid(t) && t !== TILE.GATE && this.staffAt(x, y) < 0 && this.money >= this.cost('staff') &&
        this.staff.every(s => Math.abs(s.x - x) + Math.abs(s.y - y) > 2);
    }
    if (tool === 'gate') {
      if (this.money < this.cost('gate')) return false;
      if (this.openable[i] && t === TILE.BUILDING) return true; // abrir passagem interna
      if (!(t === TILE.WALL && this.isBorder(x, y))) return false;
      if (lv.noGates) return false;
      const nx = x === 0 ? 1 : x === this.W - 1 ? this.W - 2 : x;
      const ny = y === 0 ? 1 : y === this.H - 1 ? this.H - 2 : y;
      const inner = this.tileAt(nx, ny);
      return inner === TILE.FLOOR || inner === TILE.GATE || inner === TILE.GRASS;
    }
    if (tool === 'erase') return this.placed[i] > 0 || this.staffAt(x, y) >= 0;
    return false;
  }

  place(tool, x, y) {
    if (!this.canPlace(tool, x, y)) return false;
    const i = this.idx(x, y);
    if (tool === 'fence') {
      this.placed[i] = this.tiles[i] === TILE.GRASS ? 2 : 1; // lembra o piso original
      this.tiles[i] = TILE.FENCE; this.money -= this.cost('fence');
    } else if (tool === 'gate') {
      if (this.openable[i] && this.tiles[i] === TILE.BUILDING) {
        this.tiles[i] = this.level.openTo ?? TILE.FLOOR; this.placed[i] = 3;
      } else { this.tiles[i] = TILE.GATE; this.placed[i] = 1; }
      this.money -= this.cost('gate');
    } else if (tool === 'staff') {
      this.staff.push({ x, y }); this.money -= this.cost('staff'); this.updateCalm();
    } else if (tool === 'erase') {
      const si = this.staffAt(x, y);
      if (si >= 0) { // reembolso só do valor-base
        this.staff.splice(si, 1); this.money += this.level.costs.staff; this.updateCalm();
      } else {
        const t = this.tiles[i];
        if (t === TILE.FENCE) { this.tiles[i] = this.placed[i] === 2 ? TILE.GRASS : TILE.FLOOR; this.money += this.level.costs.fence; }
        if (t === TILE.GATE) { this.tiles[i] = TILE.WALL; this.money += this.level.costs.gate; }
        else if (this.placed[i] === 3) { this.tiles[i] = TILE.BUILDING; this.money += this.level.costs.gate; }
        this.placed[i] = 0;
      }
    }
    this.version++;
    return true;
  }

  updateCalm() {
    const { W, H } = this;
    this.calm.fill(0);
    const R = this.p.staffRadius;
    for (const s of this.staff) {
      for (let y = Math.max(0, s.y - R); y <= Math.min(H - 1, s.y + R); y++) {
        for (let x = Math.max(0, s.x - R); x <= Math.min(W - 1, s.x + R); x++) {
          const d = Math.hypot(x - s.x, y - s.y);
          if (d > R) continue;
          const i = y * W + x;
          this.calm[i] = Math.max(this.calm[i], 1 - (d / R) * 0.6);
        }
      }
    }
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
        let c = (ox && oy ? SQ2 : 1) * tileCost(tiles[j]);
        if (density) c *= 1 + congestion * density[j];
        const nd = d + c;
        if (nd < dist[j]) { dist[j] = nd; heap.push(j, nd); }
      }
    }
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
    if (this.size >= this.k.length) {
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
    this.panic = new Float32Array(N);
    this.fx = new Float32Array(N); this.fy = new Float32Array(N); // direção de fuga do susto
    this.state = new Uint8Array(N).fill(STATE.GONE);
    this.shirt = new Uint8Array(N);       // índice de cor da camiseta
    this.heading = new Float32Array(N);   // para onde a pessoa está virada (rad)
    this.walk = new Float32Array(N);      // fase do passo (animação)
    this.localD = new Float32Array(N);
    this.spawned = 0; this.exited = 0; this.trampled = 0;
    this.events = [];   // quedas {x,y,t}
    this.time = 0;
    this.history = [];  // {t, trampled, peak, active} a cada 1 s (gráfico final)
    this.histTimer = 0; this.windowPeak = 0;

    const n = world.W * world.H;
    this.count = new Float32Array(n);
    this.density = new Float32Array(n);
    this.head = new Int32Array(n);
    this.next = new Int32Array(N);
    this.peakDensity = 0;
    this.gridStale = true;
    this.hot = { x: world.W / 2, y: world.H / 2, d: 0 }; // ponto mais apertado (câmera)

    this.field = new FlowField(world);
    this.stageField = new FlowField(world);
    this.stageCells = () => {
      const c = world.stageEdgeCells();
      if (c.length || !this.attractor) return c;
      return this.ringCells(); // sem palco: o "palco" é o trio elétrico
    };
    this.spawnCells = world.spawnCells();
    this.spawnAcc = new Float32Array(Math.max(1, this.spawnCells.length));
    this.worldVersion = world.version;

    // trio elétrico / carro de som (atrator móvel)
    this.attractor = null;
    if (lv.parade) {
      const [x, y] = lv.parade.path[0];
      this.attractor = { x, y, dirX: 0, dirY: 1, seg: 0, r: lv.parade.radius ?? 2.2 };
    }

    this.stageField.compute(this.stageCells());
    this.phases = lv.phases;
    this.phaseIdx = -1;
    this.done = false;
    this.surge = 0;
    this.nextPhase();
  }

  get phase() { return this.phases[this.phaseIdx]; }
  get active() { let c = 0; for (let i = 0; i < this.N; i++) if (this.state[i] === STATE.ACTIVE) c++; return c; }

  nextPhase() {
    this.phaseIdx++;
    this.phaseTime = 0;
    this.stallTime = 0; this.lastExited = this.exited;
    if (this.phaseIdx >= this.phases.length) { this.done = true; return; }
    const ph = this.phase;
    if (ph.kind === 'fill') this.fillZone(ph.zone, ph.count ?? this.N);
    if (ph.kind === 'burst') { this.burstLeft = ph.count; this.burstAcc = 0; }
    this.refreshField();
    this.fieldTimer = 0;
  }

  isExitLike(ph = this.phase) { return ph && (ph.kind === 'exit' || ph.kind === 'burst'); }

  targetCells() {
    const ph = this.phase;
    if (this.isExitLike(ph)) return this.w.gateCells();
    if (ph.kind === 'follow') return this.ringCells();
    return this.w.zoneCells(ph.zone);
  }

  // ponto que a multidão persegue: logo atrás do trio (a "pipoca" vai atrás)
  followPoint() {
    const a = this.attractor;
    return [a.x - a.dirX * (a.r + 1), a.y - a.dirY * (a.r + 1)];
  }

  ringCells() {
    const a = this.attractor, w = this.w, out = [];
    const [cx, cy] = this.followPoint();
    const R = 9;
    for (let y = Math.max(0, (cy - R) | 0); y <= Math.min(w.H - 1, (cy + R) | 0); y++) {
      for (let x = Math.max(0, (cx - R) | 0); x <= Math.min(w.W - 1, (cx + R) | 0); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const da = Math.hypot(x + 0.5 - a.x, y + 0.5 - a.y);
        if (d <= R && da > a.r + 0.6 && !isSolid(w.tiles[y * w.W + x])) out.push(y * w.W + x);
      }
    }
    if (!out.length) out.push(((a.y | 0) * w.W) + (a.x | 0));
    return out;
  }

  refreshField() {
    this.field.compute(this.targetCells(), this.density, this.p.congestionCost);
  }

  spawnAt(cellIdx) {
    if (this.spawned >= this.N) return false;
    const i = this.spawned;
    const W = this.w.W;
    const cx = cellIdx % W, cy = (cellIdx / W) | 0;
    this.x[i] = cx + 0.2 + this.rng() * 0.6;
    this.y[i] = cy + 0.2 + this.rng() * 0.6;
    this.vx[i] = 0; this.vy[i] = 0;
    this.v0[i] = this.p.speed + (this.rng() * 2 - 1) * this.p.speedVar;
    this.stress[i] = 0; this.panic[i] = 0;
    this.state[i] = STATE.ACTIVE;
    this.shirt[i] = (this.rng() * 255) | 0;
    this.heading[i] = this.rng() * 6.283;
    this.walk[i] = this.rng() * 6.283;
    this.spawned++;
    return true;
  }

  fillZone(z, count) {
    const cells = this.w.zoneCells(z);
    for (let k = 0; k < count && this.spawned < this.N; k++) {
      this.spawnAt(cells[(this.rng() * cells.length) | 0]);
    }
  }

  // ondas de euforia durante o show
  excitementNow(ph) {
    let e = ph.excitement ?? 1;
    if (ph.kind === 'hold' || ph.kind === 'follow') {
      const per = this.p.surgeEvery;
      const t = this.phaseTime % per;
      this.surge = t > per - this.p.surgeLength ? 1 : 0;
      e += this.surge * this.p.surgeBoost;
    } else this.surge = 0;
    return e;
  }

  step(dt) {
    if (this.done) return;
    const w = this.w, p = this.p, W = w.W, H = w.H;
    const N = this.N;
    this.time += dt; this.phaseTime += dt; this.fieldTimer += dt;
    const ph = this.phase;

    // edição em tempo real: o jogador mexeu no mapa
    if (w.version !== this.worldVersion) {
      this.worldVersion = w.version;
      this.stageField.compute(this.stageCells());
      this.spawnCells = w.spawnCells();
      if (this.spawnAcc.length < this.spawnCells.length) {
        const a = new Float32Array(this.spawnCells.length); a.set(this.spawnAcc); this.spawnAcc = a;
      }
      this.fieldTimer = p.fieldRefresh; // recalcula já
    }

    // ---- trio elétrico anda pelo percurso
    if (ph.kind === 'follow' && this.attractor) this.moveAttractor(dt);

    // ---- entrada do público
    if (ph.kind === 'enter' && this.spawned < N && this.spawnCells.length) {
      const rate = (w.level.spawnRate || 6) / Math.max(1, this.spawnCells.length / 2);
      for (let s = 0; s < this.spawnCells.length; s++) {
        this.spawnAcc[s] += rate * dt;
        const c = this.spawnCells[s];
        while (this.spawnAcc[s] >= 1 && this.spawned < N) {
          if (this.density[c] > p.spawnMaxDensity) { this.spawnAcc[s] = Math.min(this.spawnAcc[s], 2); break; }
          this.spawnAcc[s] -= 1;
          this.spawnAt(c);
        }
      }
    }
    // ---- trem chegou: desembarque pelas portas
    if (ph.kind === 'burst' && this.burstLeft > 0) {
      const doors = w.level.doors;
      this.burstAcc += (ph.count / (ph.unload || 4)) * dt;
      while (this.burstAcc >= 1 && this.burstLeft > 0 && this.spawned < N) {
        this.burstAcc -= 1; this.burstLeft--;
        this.spawnAt(doors[(this.rng() * doors.length) | 0]);
      }
    }

    if (this.gridStale) { this.buildGrid(); this.gridStale = false; }
    const fieldEvery = ph.kind === 'follow' ? 0.5 : p.fieldRefresh;
    if (this.fieldTimer >= fieldEvery) { this.fieldTimer = 0; this.refreshField(); }

    // ---- vontade de cada pessoa
    const dir = [0, 0];
    const relax = Math.min(1, dt / p.relax);
    const isExit = this.isExitLike(ph);
    const zoneId = ph.zone;
    const excitement = this.excitementNow(ph);
    const a = this.attractor;
    for (let i = 0; i < N; i++) {
      if (this.state[i] !== STATE.ACTIVE) continue;
      const cx = clampI(this.x[i] | 0, 0, W - 1), cy = clampI(this.y[i] | 0, 0, H - 1);
      const ci = cy * W + cx;
      const d = this.density[ci];
      const calm = w.calm[ci] * p.staffCalm;
      const exc = 1 + (excitement - 1) * (1 - calm);
      let tx = 0, ty = 0, sp = this.v0[i] * tileSpeed(w.tiles[ci]);
      let stopped = false;
      if (ph.kind === 'follow' && a) {
        const dxa = this.x[i] - a.x, dya = this.y[i] - a.y;
        const da = Math.hypot(dxa, dya);
        const ahead = dxa * a.dirX + dya * a.dirY;
        const trioV = w.level.parade.speed;
        if (ahead > a.r * 0.6 && da < a.r + 5) {
          // logo na frente do caminhão: anda à frente e abre para os lados
          const side = dxa * -a.dirY + dya * a.dirX >= 0 ? 1 : -1;
          tx = a.dirX + -a.dirY * side * 0.9; ty = a.dirY + a.dirX * side * 0.9;
          const l = Math.hypot(tx, ty); tx /= l; ty /= l;
        } else if (ahead > 0 && da >= a.r + 5) {
          // mais à frente: o trio vem até ela, vai andando devagar no sentido do desfile
          tx = a.dirX; ty = a.dirY; sp = Math.min(sp, trioV * 1.1);
        } else if (da < a.r + 9) {
          // em volta do trio (pipoca): chega mais perto se houver espaço
          if (da > a.r + 1 && d < p.standDensity * exc) { tx = -dxa / da; ty = -dya / da; sp *= 0.6 * exc; }
          else { tx = a.dirX; ty = a.dirY; sp = Math.min(sp, trioV * 1.05); }
        } else {
          this.field.sample(this.x[i], this.y[i], dir); tx = dir[0]; ty = dir[1];
          if (d > 2.5) sp = Math.min(sp, trioV * 1.2 + 0.2); // no embalo, sem forçar
        }
      } else if (!isExit && w.zone[ci] === zoneId && (ph.kind === 'hold' || ph.kind === 'enter' || ph.kind === 'move')) {
        const stand = p.standDensity * exc;
        if (w.tiles[ci] === TILE.SEATS) { stopped = true; sp = 0; } // sentado na arquibancada
        else if (d < stand) {
          this.stageField.sample(this.x[i], this.y[i], dir);
          tx = dir[0]; ty = dir[1]; sp *= 0.4 * exc;
        } else { stopped = true; sp = 0; }
      } else {
        this.field.sample(this.x[i], this.y[i], dir);
        tx = dir[0]; ty = dir[1];
        if (isExit) sp *= 1.15;
      }
      // diagrama fundamental: mais gente à frente, mais devagar
      if (!stopped) {
        const ahead = this.densityAt(this.x[i] + tx * 0.8, this.y[i] + ty * 0.8);
        const urg = (isExit ? p.exitUrgency : 1 + (exc - 1) * 0.5) + this.panic[i] * p.panicPush;
        sp *= Math.max(0.08, 1 - ahead / (p.jamDensity * urg));
      }
      // pânico: corre para longe do ponto do susto
      const pn = this.panic[i];
      if (pn > 0.05) {
        tx += this.fx[i] * pn * 1.2; ty += this.fy[i] * pn * 1.2;
        const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
        sp = Math.max(sp, this.v0[i] * pn * 0.9);
        this.panic[i] = Math.max(0, pn - p.panicDecay * (1 + calm * 6) * dt);
      }
      tx += (this.rng() - 0.5) * 0.15; ty += (this.rng() - 0.5) * 0.15;
      this.vx[i] += (tx * sp - this.vx[i]) * relax;
      this.vy[i] += (ty * sp - this.vy[i]) * relax;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      // animação: direção e passada
      const v2 = this.vx[i] * this.vx[i] + this.vy[i] * this.vy[i];
      if (v2 > 0.02) {
        const target = Math.atan2(this.vy[i], this.vx[i]);
        let dh = target - this.heading[i];
        dh -= Math.round(dh / 6.283185) * 6.283185;
        this.heading[i] += dh * Math.min(1, dt * 8);
      } else if ((ph.kind === 'hold' || ph.kind === 'follow') && this.stageField.dist[ci] < 40) {
        // parado no show: vira para o palco
        this.stageField.sample(this.x[i], this.y[i], dir);
        if (dir[0] || dir[1]) {
          let dh = Math.atan2(dir[1], dir[0]) - this.heading[i];
          dh -= Math.round(dh / 6.283185) * 6.283185;
          this.heading[i] += dh * Math.min(1, dt * 3);
        }
      }
      this.walk[i] += Math.sqrt(v2) * dt * 9;
    }

    // ---- empurra-empurra
    this.buildGrid(false);
    for (let it = 0; it < this.p.contactIters; it++) this.resolveContacts();
    if (a && ph.kind === 'follow') this.resolveAttractor();
    this.resolveWalls();
    this.buildGrid();

    // ---- pressão, quedas e saídas
    let hotD = 0, hx = 0, hy = 0;
    for (let i = 0; i < N; i++) {
      if (this.state[i] !== STATE.ACTIVE) continue;
      const cx = clampI(this.x[i] | 0, 0, W - 1), cy = clampI(this.y[i] | 0, 0, H - 1);
      const ci = cy * W + cx;
      const d = this.densityAt(this.x[i], this.y[i]);
      this.localD[i] = d;
      if (d > this.peakDensity) this.peakDensity = d;
      if (d > this.windowPeak) this.windowPeak = d;
      if (d > hotD) { hotD = d; hx = this.x[i]; hy = this.y[i]; }
      const calm = w.calm[ci] * p.staffCalm;
      if (d > p.dangerDensity) this.stress[i] += (d - p.dangerDensity) * dt * (1 - calm);
      else this.stress[i] = Math.max(0, this.stress[i] - p.stressRecover * dt);
      if (this.stress[i] > p.stressToFall) {
        this.fall(i);
        continue;
      }
      if (isExit && w.tiles[ci] === TILE.GATE) {
        this.state[i] = STATE.GONE; this.exited++;
      }
    }
    // ponto quente suavizado (para a câmera do perigo)
    const k = Math.min(1, dt * 1.5);
    if (hotD > 2.5) { this.hot.x += (hx - this.hot.x) * k; this.hot.y += (hy - this.hot.y) * k; }
    this.hot.d = hotD;

    // ---- histórico para o gráfico
    this.histTimer += dt;
    if (this.histTimer >= 1) {
      this.histTimer = 0;
      this.history.push({ t: this.time, trampled: this.trampled, peak: this.windowPeak });
      this.windowPeak = 0;
    }

    this.advancePhase(dt);
  }

  fall(i) {
    const p = this.p, W = this.w.W, H = this.w.H;
    this.state[i] = STATE.FALLEN; this.vx[i] = 0; this.vy[i] = 0;
    this.trampled++;
    const ex = this.x[i], ey = this.y[i];
    this.events.push({ x: ex, y: ey, t: this.time });
    // susto se espalha (contágio de pânico)
    const R = p.panicRadius;
    const x0 = Math.max(0, (ex - R) | 0), x1 = Math.min(W - 1, (ex + R) | 0);
    const y0 = Math.max(0, (ey - R) | 0), y1 = Math.min(H - 1, (ey + R) | 0);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      let j = this.head[cy * W + cx];
      while (j !== -1) {
        if (this.state[j] === STATE.ACTIVE) {
          const dx = this.x[j] - ex, dy = this.y[j] - ey;
          const d = Math.hypot(dx, dy);
          if (d < R && d > 1e-3) {
            const g = p.panicGain * (1 - d / R) * (1 - this.w.calm[cy * W + cx] * 0.7);
            if (g > this.panic[j] * 0.5) { this.fx[j] = dx / d; this.fy[j] = dy / d; }
            this.panic[j] = Math.min(1.5, this.panic[j] + g);
          }
        }
        j = this.next[j];
      }
    }
  }

  advancePhase(dt) {
    const ph = this.phase, w = this.w, W = w.W, H = w.H, N = this.N;
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
    } else if (ph.kind === 'fill') {
      this.nextPhase();
    } else if (ph.kind === 'hold') {
      if (this.phaseTime >= ph.duration) this.nextPhase();
    } else if (ph.kind === 'follow') {
      if (this.attractor.finished || this.phaseTime > (ph.maxTime || 300)) this.nextPhase();
    } else if (ph.kind === 'burst') {
      if (this.burstLeft <= 0 && this.phaseTime >= (ph.interval || 15)) this.nextPhase();
    } else if (ph.kind === 'exit') {
      if (this.exited !== this.lastExited) { this.lastExited = this.exited; this.stallTime = 0; }
      else if (this.exited > 0) this.stallTime += dt;
      if (act === 0 || this.stallTime > 20 || this.phaseTime > (ph.maxTime || 240)) this.nextPhase();
    }
  }

  moveAttractor(dt) {
    const a = this.attractor, path = this.w.level.parade.path;
    let left = this.w.level.parade.speed * dt;
    while (left > 0 && a.seg < path.length - 1) {
      const [tx, ty] = path[a.seg + 1];
      const dx = tx - a.x, dy = ty - a.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-3) { a.seg++; continue; }
      a.dirX = dx / d; a.dirY = dy / d;
      // não atropela: se a frente estiver lotada, o trio espera
      const front = this.densityAt(a.x + a.dirX * (a.r + 1), a.y + a.dirY * (a.r + 1));
      const mult = Math.max(0, Math.min(1, 1.6 - front / 3)); // trava se a frente estiver lotada
      const mv = Math.min(d, left * mult);
      a.x += a.dirX * mv; a.y += a.dirY * mv;
      if (mv < d) break;
      a.seg++; left -= mv;
    }
    if (a.seg >= path.length - 1) a.finished = true;
  }

  resolveAttractor() {
    const a = this.attractor, r = a.r + this.p.radius;
    for (let i = 0; i < this.N; i++) {
      if (this.state[i] !== STATE.ACTIVE) continue;
      const dx = this.x[i] - a.x, dy = this.y[i] - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < r * r) {
        const d = Math.sqrt(d2) || 1e-3;
        this.x[i] = a.x + dx / d * r; this.y[i] = a.y + dy / d * r;
      }
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
      if (withDensity) this.count[c] += s === STATE.FALLEN ? 1.6 : 1;
    }
    if (!withDensity) return;
    // suavização 3x3 com pesos [1,2,1] separáveis (horizontal e depois vertical)
    if (this.areaVersion !== this.w.version) this.computeArea();
    const cnt = this.count, tmp = this.tmp, den = this.density, inv = this.invArea;
    for (let y = 0; y < H; y++) {
      const r = y * W;
      for (let x = 0; x < W; x++) {
        const i = r + x;
        tmp[i] = 2 * cnt[i] + (x > 0 ? cnt[i - 1] : 0) + (x < W - 1 ? cnt[i + 1] : 0);
      }
    }
    for (let y = 0; y < H; y++) {
      const r = y * W;
      for (let x = 0; x < W; x++) {
        const i = r + x;
        den[i] = (2 * tmp[i] + (y > 0 ? tmp[i - W] : 0) + (y < H - 1 ? tmp[i + W] : 0)) * inv[i];
      }
    }
  }

  // área livre ponderada em volta de cada célula (muda só quando o mapa muda)
  computeArea() {
    const W = this.w.W, H = this.w.H, tiles = this.w.tiles;
    if (!this.invArea) { this.invArea = new Float32Array(W * H); this.tmp = new Float32Array(W * H); }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let a = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const nx = x + ox, ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (!isSolid(tiles[ny * W + nx])) a += (ox === 0 ? 2 : 1) * (oy === 0 ? 2 : 1);
      }
      this.invArea[y * W + x] = a > 0 ? 1 / a : 0;
    }
    this.areaVersion = this.w.version;
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
    const X = this.x, Y = this.y, st = this.state, head = this.head, next = this.next;
    const rr0 = 4 * r * r, rf = r + rb, rr1 = rf * rf;
    for (let i = 0; i < this.N; i++) {
      if (st[i] !== STATE.ACTIVE) continue;
      const cx = X[i] | 0, cy = Y[i] | 0;
      for (let oy = -1; oy <= 1; oy++) {
        const ny = cy + oy; if (ny < 0 || ny >= H) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const nx = cx + ox; if (nx < 0 || nx >= W) continue;
          let j = head[ny * W + nx];
          while (j !== -1) {
            const sj = st[j];
            if (j !== i && (sj === STATE.FALLEN || (j > i && sj === STATE.ACTIVE))) {
              let dx = X[i] - X[j], dy = Y[i] - Y[j];
              let d2 = dx * dx + dy * dy;
              const fallen = sj === STATE.FALLEN;
              const lim = fallen ? rr1 : rr0;
              if (d2 < lim) {
                if (d2 < 1e-8) { dx = this.rng() - 0.5; dy = this.rng() - 0.5; d2 = dx * dx + dy * dy; }
                const d = Math.sqrt(d2);
                const ov = ((fallen ? rf : 2 * r) - d) / d;
                if (fallen) { X[i] += dx * ov * 0.5; Y[i] += dy * ov * 0.5; }
                else {
                  X[i] += dx * ov * k; Y[i] += dy * ov * k;
                  X[j] -= dx * ov * k; Y[j] -= dy * ov * k;
                }
              }
            }
            j = next[j];
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
          const dx = this.x[i] - qx, dy = this.y[i] - qy;
          const d2 = dx * dx + dy * dy;
          if (d2 < r * r) {
            if (d2 < 1e-10) { this.x[i] = cx + 0.5; this.y[i] = cy + 0.5; continue; }
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
    return {
      trampled: t, exited: this.exited, stars, passed: stars > 0, time: this.time,
      peak: this.peakDensity, history: this.history, spent: lv.budget - this.w.money,
    };
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
