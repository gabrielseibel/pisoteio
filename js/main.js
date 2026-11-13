// =============================================================
// PISOTEIO — interface, entrada (toque/mouse), câmera e laço do jogo
// =============================================================
import { World, Simulation, STATE } from './sim.js';
import { LEVELS, makeLevel } from './levels.js';
import { Renderer } from './render.js';
import { CrowdAudio } from './audio.js';

const $ = id => document.getElementById(id);
const canvas = $('view');
const renderer = new Renderer(canvas);
const audio = new CrowdAudio();

const game = {
  levelIdx: 0,
  world: null,
  sim: null,
  mode: 'menu',      // menu | plan | run | result
  tool: 'fence',
  speed: 1,
  paused: false,
  heat: true,
  follow: false,
  building: false,   // gaveta de obras aberta durante o evento
  undo: [],          // pilha de ações para desfazer
  lastTrampled: 0,
  lastPhase: -1,
};

// ---------- progresso salvo ----------
function loadStars() {
  try { return JSON.parse(localStorage.getItem('pisoteio.stars') || '{}'); } catch { return {}; }
}
function saveStars(id, n) {
  const s = loadStars();
  if ((s[id] || 0) >= n) return;
  s[id] = n;
  try { localStorage.setItem('pisoteio.stars', JSON.stringify(s)); } catch { /* sem armazenamento */ }
}
const starStr = n => [0, 1, 2].map(i => `<span class="${i < n ? 'on' : ''}">★</span>`).join('');

// ---------- MENU ----------
function showMenu() {
  game.mode = 'menu';
  game.sim = null;
  $('game').classList.add('hidden');
  $('menu').classList.remove('hidden');
  hideModal();
  const stars = loadStars();
  const list = $('level-list');
  list.innerHTML = '';
  LEVELS.forEach((mk, i) => {
    const lv = mk();
    const b = document.createElement('button');
    b.className = 'level-card';
    b.innerHTML = `<div class="ico">${lv.icon || '•'}</div>
      <div class="info"><div class="name">${i + 1}. ${lv.name}</div>
      <div class="sub">${lv.crowd} pessoas · limite ${lv.maxTrampled} pisoteados${lv.night ? ' · noite' : ''}</div></div>
      <div class="stars">${starStr(stars[lv.id] || 0)}</div>`;
    b.onclick = () => startLevel(i);
    list.appendChild(b);
  });
}

// ---------- FASE ----------
function startLevel(i) {
  game.levelIdx = i;
  game.world = new World(makeLevel(i));
  game.undo = [];
  $('menu').classList.add('hidden');
  $('game').classList.remove('hidden');
  requestAnimationFrame(() => {
    renderer.setWorld(game.world);
    enterPlan(true);
  });
}

function enterPlan(withBrief) {
  game.mode = 'plan';
  game.sim = null;
  game.world.costMult = 1;
  game.lastTrampled = 0;
  game.lastPhase = -1;
  const lv = game.world.level;
  $('level-name').textContent = `${lv.icon || ''} ${lv.name}`;
  $('phase').textContent = 'Planejamento: monte o espaço';
  $('btn-start').disabled = false;
  $('btn-start').textContent = '▶ Começar';
  $('risk').classList.add('hidden');
  $('limit').textContent = lv.maxTrampled;
  setRunUI(false);
  if (game.tool === 'pan') selectTool('fence');
  updateTools();
  updateBadge(0);
  updateMoney();
  renderer.rebuildPreview();
  if (withBrief) showBrief(); else { banner('VOCÊ PLANEJA'); planHint(); }
}

function planHint() {
  hint(renderer.mobile
    ? '1 dedo: construir em linha · 2 dedos: mover e zoom'
    : 'Arraste para construir em linha · roda do mouse: zoom · botão do meio: mover', 5000);
}

// controles visíveis: planejamento × evento ao vivo
function setRunUI(running) {
  const tb = document.querySelector('.toolbar');
  tb.classList.toggle('running', running);
  tb.classList.toggle('building', running && game.building);
  for (const id of ['btn-pause', 'btn-speed', 'btn-build']) $(id).classList.toggle('hidden', !running);
  $('z-follow').classList.toggle('hidden', !running);
  $('btn-build').classList.toggle('active', game.building);
  $('btn-undo').classList.toggle('hidden', running && !game.building);
}

function updateTools() {
  const w = game.world, lv = w.level;
  const allowed = t => t === 'pan' || t === 'erase' || (lv.tools || ['fence', 'gate', 'staff']).includes(t);
  const gateBlocked = lv.noGates && !w.openable.some(v => v);
  document.querySelectorAll('.tool').forEach(b => {
    const t = b.dataset.tool;
    b.disabled = !allowed(t) || (t === 'gate' && gateBlocked);
  });
  $('cost-fence').textContent = `R$ ${w.cost('fence')}`;
  $('cost-gate').textContent = document.querySelector('[data-tool="gate"]').disabled ? 'bloqueado' : `R$ ${w.cost('gate')}`;
  $('cost-staff').textContent = `R$ ${w.cost('staff')}`;
  $('money-mult').classList.toggle('hidden', w.costMult === 1);
  const gateBtn = document.querySelector('[data-tool="gate"]');
  $('gate-label').textContent = lv.noGates ? 'Abrir' : 'Portão';
  $('btn-undo').disabled = !game.undo.length;
}

function showBrief() {
  const lv = game.world.level;
  const hasOpen = game.world.openable.some(v => v);
  showModal(`${lv.icon || ''} ${lv.name}`, `
    <p>${lv.brief}</p>
    <div class="goal">
      <div><b>${lv.crowd}</b><span>pessoas</span></div>
      <div><b>≤ ${lv.maxTrampled}</b><span>pisoteados para passar</span></div>
    </div>
    <p class="tip">💡 ${lv.tip}</p>
    <p style="font-size:13px;color:#a3a6ad">
      ${hasOpen ? 'As listras amarelas e pretas são passagens fechadas: use <b>Abrir</b> para liberar. ' : ''}
      <b>Seguranças</b> acalmam quem está perto: menos euforia, menos pânico.
      Durante o evento você ainda pode construir, pagando o dobro.
      Arraste para construir uma linha inteira; a prévia mostra o custo antes de soltar.
      Dois dedos (ou a roda do mouse) dão zoom.</p>`,
    [{ label: 'Planejar', primary: true, fn: () => { hideModal(); banner('VOCÊ PLANEJA'); planHint(); } }]);
}

function startRun() {
  if (game.mode !== 'plan') return;
  audio.init();
  game.mode = 'run';
  game.paused = false;
  game.world.costMult = 2;           // obra de emergência
  game.sim = new Simulation(game.world, (Math.random() * 1e9) | 0);
  $('risk').classList.remove('hidden');
  $('btn-start').disabled = true;
  $('btn-start').textContent = 'Ao vivo';
  game.building = false;
  selectTool('pan');
  setRunUI(true);
  updateTools();
  setSpeed(game.speed);
  hint(renderer.mobile ? 'Arraste para olhar · 🛠 obras (×2) · 🎥 segue o perigo' : 'Arraste para olhar · 🛠 obras de emergência (×2) · 🎥 segue o perigo', 4500);
  banner('ELES CHEGAM');
}

function finish() {
  game.mode = 'result';
  game.world.costMult = 1;
  game.building = false;
  cancelStroke();
  updateTools();
  const r = game.sim.result();
  const lv = game.world.level;
  if (r.passed) saveStars(lv.id, r.stars);
  const next = game.levelIdx + 1 < LEVELS.length;
  const title = r.passed ? (r.stars === 3 ? 'Evento perfeito!' : 'Evento concluído') : 'Tragédia';
  const msg = r.passed
    ? (r.stars === 3 ? 'Ninguém se machucou. Todo mundo foi para casa.' : 'Passou, mas dá para fazer melhor.')
    : 'O espaço não aguentou a multidão. Veja no gráfico quando a pressão subiu e replaneje.';
  const actions = [
    { label: 'Menu', fn: showMenu },
    { label: 'Replanejar', fn: () => { hideModal(); enterPlan(false); } },
  ];
  if (r.passed && next) actions.push({ label: 'Próxima fase ▶', primary: true, fn: () => startLevel(game.levelIdx + 1) });
  showModal(title, `
    <div class="big-stars">${starStr(r.stars)}</div>
    <p style="text-align:center">${msg}</p>
    <div class="goal">
      <div><b style="color:var(--danger)">${r.trampled}</b><span>pisoteados (limite ${lv.maxTrampled})</span></div>
      <div><b>${r.exited}</b><span>saíram em segurança</span></div>
      <div><b>${r.peak.toFixed(1)}</b><span>pico de pessoas/m²</span></div>
      <div><b>R$ ${r.spent}</b><span>gasto em ${formatTime(r.time)} de evento</span></div>
    </div>
    <canvas class="chart" id="chart"></canvas>
    <div class="legend"><span><i style="background:#f5a623"></i>pressão máxima (p/m²)</span><span><i style="background:#e5383b"></i>pisoteados</span></div>`, actions);
  drawChart($('chart'), r.history, game.sim.p.dangerDensity);
  if (r.passed) audio.cheer(0.6);
}

function drawChart(cv, hist, danger) {
  if (!cv || !hist.length) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = cv.clientWidth, h = cv.clientHeight;
  cv.width = w * dpr; cv.height = h * dpr;
  const c = cv.getContext('2d');
  c.scale(dpr, dpr);
  const pad = 10;
  const T = hist[hist.length - 1].t;
  const maxP = Math.max(danger * 1.3, ...hist.map(p => p.peak));
  const maxT = Math.max(1, hist[hist.length - 1].trampled);
  const X = t => pad + (t / T) * (w - pad * 2);
  // faixa de perigo
  const yd = h - pad - (danger / maxP) * (h - pad * 2);
  c.fillStyle = 'rgba(229,56,59,0.12)';
  c.fillRect(pad, pad, w - pad * 2, yd - pad);
  c.strokeStyle = 'rgba(229,56,59,0.5)'; c.setLineDash([4, 4]);
  c.beginPath(); c.moveTo(pad, yd); c.lineTo(w - pad, yd); c.stroke(); c.setLineDash([]);
  c.lineWidth = 2;
  c.strokeStyle = '#f5a623';
  c.beginPath();
  hist.forEach((p, k) => { const y = h - pad - (p.peak / maxP) * (h - pad * 2); k ? c.lineTo(X(p.t), y) : c.moveTo(X(p.t), y); });
  c.stroke();
  c.strokeStyle = '#e5383b';
  c.beginPath();
  hist.forEach((p, k) => { const y = h - pad - (p.trampled / maxT) * (h - pad * 2) * 0.9; k ? c.lineTo(X(p.t), y) : c.moveTo(X(p.t), y); });
  c.stroke();
}

// ---------- HUD ----------
function updateMoney() { $('money').textContent = game.world.money; }
function updateBadge(n) {
  const b = $('badge');
  if (game.world) $('limit').textContent = game.world.level.maxTrampled;
  $('trampled').textContent = n;
  const lim = game.world.level.maxTrampled;
  b.classList.toggle('warn', n > 0 && n <= lim);
  b.classList.toggle('dead', n > lim);
}
function bumpBadge() {
  const b = $('badge');
  b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
}
function banner(text) {
  const el = $('banner');
  el.textContent = text;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}
let hintTimer = 0;
function hint(text, ms = 3000) {
  const el = $('hint');
  el.textContent = text; el.classList.add('show');
  clearTimeout(hintTimer); hintTimer = setTimeout(() => el.classList.remove('show'), ms);
}
const formatTime = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function phaseText(sim) {
  const ph = sim.phase;
  if (!ph) return 'Fim do evento';
  if (ph.kind === 'enter') return `${ph.label} · ${sim.spawned}/${sim.N} dentro`;
  if (ph.kind === 'move') return `${ph.label} · ${sim.inZone || 0} chegaram`;
  if (ph.kind === 'hold') return `${ph.label} · ${Math.max(0, Math.ceil(ph.duration - sim.phaseTime))}s`;
  if (ph.kind === 'follow') return `${ph.label} · percurso ${Math.round(100 * sim.attractor.seg / Math.max(1, game.world.level.parade.path.length - 1) + (sim.attractor.finished ? 0 : progressSeg(sim)))}%`;
  if (ph.kind === 'burst') return `${ph.label} · ${sim.active} na estação`;
  return `${ph.label} · ${sim.exited} saíram`;
}
function progressSeg(sim) {
  const path = game.world.level.parade.path, a = sim.attractor;
  const [x0, y0] = path[a.seg], [x1, y1] = path[a.seg + 1] || path[a.seg];
  const L = Math.hypot(x1 - x0, y1 - y0) || 1;
  return (Math.hypot(a.x - x0, a.y - y0) / L) * 100 / Math.max(1, path.length - 1);
}

// ---------- MODAL ----------
function showModal(title, html, actions) {
  $('m-title').textContent = title;
  $('m-body').innerHTML = html;
  const box = $('m-actions');
  box.innerHTML = '';
  for (const a of actions) {
    const b = document.createElement('button');
    b.textContent = a.label;
    if (a.primary) b.className = 'primary';
    b.onclick = a.fn;
    box.appendChild(b);
  }
  $('modal').classList.remove('hidden');
}
function hideModal() { $('modal').classList.add('hidden'); }

// ---------- ENTRADA: construir em linha, arrastar, pinça, toque duplo ----------
// Construção em "traço": arrastar mostra uma prévia (verde = dá, vermelho = não dá) com o custo;
// nada é construído até soltar. Um segundo dedo cancela o traço e vira pinça/arrasto.
const pointers = new Map();
let stroke = null;   // { tool, start, end, cells:[{x,y,ok}], cost }
let pinch = null, panning = false, lastTap = { t: 0, x: 0, y: 0 }, downAt = null;
const LINE_TOOLS = new Set(['fence', 'gate', 'erase']);

function canBuild() { return game.mode === 'plan' || (game.mode === 'run' && game.building); }

function lineCells(a, b) {
  const out = [];
  let x0 = a.x, y0 = a.y; const x1 = b.x, y1 = b.y;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let n = 0; n < 400; n++) {
    out.push({ x: x0, y: y0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return out;
}
// trava em reta horizontal/vertical/45° quando o traço está quase alinhado
function snapEnd(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax > ay * 2.2) return { x: b.x, y: a.y };
  if (ay > ax * 2.2) return { x: a.x, y: b.y };
  const m = Math.max(ax, ay);
  return { x: a.x + Math.sign(dx) * m, y: a.y + Math.sign(dy) * m };
}

function evalStroke() {
  const w = game.world, st = stroke;
  const cells = st.tool === 'staff' ? [st.end] : lineCells(st.start, snapEnd(st.start, st.end));
  let money = w.money, cost = 0, okN = 0;
  st.cells = cells.map(({ x, y }) => {
    let ok = w.canPlace(st.tool, x, y);
    if (ok && st.tool !== 'erase') {
      const c = w.cost(st.tool);
      if (c > money) ok = false; else { money -= c; cost += c; }
    }
    if (ok) okN++;
    return { x, y, ok };
  });
  st.cost = cost; st.okN = okN;
  renderer.ghost = { tool: st.tool, cells: st.cells };
  const lab = $('ghost-label');
  const p = st.screen;
  const r = canvas.getBoundingClientRect();
  lab.style.left = `${p.x - r.left}px`;
  lab.style.top = `${p.y - r.top - (renderer.mobile ? 56 : 18)}px`;
  const n = st.cells.length;
  const name = { fence: 'Grade', gate: game.world.level.noGates ? 'Abrir' : 'Portão', staff: 'Segurança', erase: 'Apagar' }[st.tool];
  lab.textContent = st.tool === 'erase' ? `${name}: ${okN}` : okN ? `${name} ${okN}${n > 1 ? ` de ${n}` : ''} · R$ ${cost}` : `${name}: aqui não dá`;
  lab.classList.toggle('bad', okN === 0);
  lab.classList.remove('hidden');
}

function startStroke(tool, e) {
  const c = renderer.cellAt(e.clientX, e.clientY);
  stroke = { tool, start: c, end: c, screen: { x: e.clientX, y: e.clientY }, cells: [] };
  evalStroke();
}
function cancelStroke() {
  stroke = null; renderer.ghost = null;
  $('ghost-label').classList.add('hidden');
}
function commitStroke() {
  const w = game.world, st = stroke;
  cancelStroke();
  if (!st) return;
  const done = [];
  for (const { x, y, ok } of st.cells) {
    if (!ok) continue;
    let prevTool = null;
    if (st.tool === 'erase') {
      const i = w.idx(x, y);
      prevTool = w.staffAt(x, y) >= 0 ? 'staff' : w.tiles[i] === 5 || w.placed[i] === 3 ? 'gate' : 'fence';
    }
    if (w.place(st.tool, x, y)) done.push({ x, y, tool: st.tool, prevTool });
  }
  if (done.length) {
    game.undo.push(done);
    if (game.undo.length > 60) game.undo.shift();
    previewDirty = true;
    navigator.vibrate?.(12);
  } else if (st.tool !== 'erase' && w.money < w.cost(st.tool)) flashMoney();
  updateMoney(); updateTools();
}
function undo() {
  const w = game.world, act = game.undo.pop();
  if (!act) return;
  for (let k = act.length - 1; k >= 0; k--) {
    const a = act[k];
    if (a.tool === 'erase') w.place(a.prevTool, a.x, a.y);
    else w.place('erase', a.x, a.y);
  }
  previewDirty = true;
  updateMoney(); updateTools();
}
function flashMoney() {
  const m = $('money').parentElement; m.classList.remove('flash'); void m.offsetWidth; m.classList.add('flash');
  hint('Sem dinheiro para isso', 1500);
}

// mover a câmera quando o traço chega perto da borda
function edgePan(e, dt) {
  const r = canvas.getBoundingClientRect(), m = 36, sp = 500 * dt;
  let dx = 0, dy = 0;
  if (e.x < r.left + m) dx = sp; else if (e.x > r.right - m) dx = -sp;
  if (e.y < r.top + m) dy = sp; else if (e.y > r.bottom - m) dy = -sp;
  if (dx || dy) { renderer.panBy(dx, dy); if (stroke) { stroke.end = renderer.cellAt(e.x, e.y); evalStroke(); } }
}

canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size >= 2) { // pinça: cancela o traço em andamento
    cancelStroke(); panning = false;
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    return;
  }
  downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
  const tool = e.button === 2 ? 'erase' : game.tool;
  if (canBuild() && tool !== 'pan' && e.button !== 1) startStroke(tool, e);
  else { panning = true; canvas.classList.add('dragging'); }
});
canvas.addEventListener('pointermove', e => {
  const prev = pointers.get(e.pointerId);
  if (!prev) { // mouse sem botão: só destaca a célula
    if (e.pointerType === 'mouse') renderer.hover = renderer.cellAt(e.clientX, e.clientY);
    return;
  }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size >= 2 && pinch) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    renderer.panBy(mx - pinch.mx, my - pinch.my);
    renderer.zoomAt(d / Math.max(1, pinch.d), mx, my);
    pinch = { d, mx, my };
    return;
  }
  if (panning) { renderer.panBy(e.clientX - prev.x, e.clientY - prev.y); return; }
  if (stroke) {
    const c = renderer.cellAt(e.clientX, e.clientY);
    stroke.screen = { x: e.clientX, y: e.clientY };
    stroke.lastEvent = { x: e.clientX, y: e.clientY };
    if (c.x !== stroke.end.x || c.y !== stroke.end.y) { stroke.end = c; }
    evalStroke();
  }
});
const endPointer = e => {
  const had = pointers.has(e.pointerId);
  pointers.delete(e.pointerId);
  if (!had) return;
  if (pinch) { if (pointers.size < 2) pinch = null; if (pointers.size === 0) panning = false; return; }
  if (pointers.size > 0) return;
  canvas.classList.remove('dragging');
  if (stroke) { if (e.type === 'pointerup') commitStroke(); else cancelStroke(); }
  // toque duplo (com a mão ou durante o evento): aproxima / volta a ver tudo
  if (panning && downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 10) {
    const now = performance.now();
    if (now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
      if (renderer.cam.z > renderer.fitView().z * 2.2) renderer.fit();
      else renderer.zoomAt(2.2, e.clientX, e.clientY);
      lastTap.t = 0;
    } else lastTap = { t: now, x: e.clientX, y: e.clientY };
  }
  panning = false; downAt = null;
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !pointers.size) renderer.hover = null; });
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const k = e.ctrlKey ? 0.01 : 0.0015; // pinça do trackpad chega com ctrlKey
  renderer.zoomAt(Math.exp(-e.deltaY * k), e.clientX, e.clientY);
  if (stroke) evalStroke();
}, { passive: false });

// ---------- BOTÕES ----------
function selectTool(t) {
  game.tool = t;
  document.querySelectorAll('.tool').forEach(x => x.classList.toggle('active', x.dataset.tool === t));
  canvas.classList.toggle('panning', t === 'pan');
}
document.querySelectorAll('.tool').forEach(b => b.addEventListener('click', () => { if (!b.disabled) selectTool(b.dataset.tool); }));
function setSpeed(v) {
  game.speed = v;
  $('btn-speed').textContent = `${v}×`;
  $('btn-pause').classList.toggle('active', game.paused);
  $('btn-pause').textContent = game.paused ? '▶' : '❚❚';
}
$('btn-speed').onclick = () => { game.paused = false; setSpeed(game.speed === 1 ? 2 : game.speed === 2 ? 4 : 1); };
$('btn-pause').onclick = () => { game.paused = !game.paused; setSpeed(game.speed); };
$('btn-build').onclick = () => {
  game.building = !game.building;
  selectTool(game.building ? (game.tool === 'pan' ? 'fence' : game.tool) : 'pan');
  setRunUI(true);
  if (game.building) hint('Obras de emergência: tudo custa o dobro', 2500);
};
$('btn-undo').onclick = undo;
$('btn-heat').onclick = () => { game.heat = !game.heat; $('btn-heat').classList.toggle('active', game.heat); };
$('btn-start').onclick = startRun;
$('btn-reset').onclick = () => { if (game.mode !== 'menu') { hideModal(); enterPlan(false); } };
$('btn-back').onclick = showMenu;
$('btn-sound').onclick = () => {
  audio.init();
  audio.setMuted(!audio.muted);
  $('btn-sound').textContent = audio.muted ? '🔇' : '🔊';
};
$('z-in').onclick = () => renderer.zoomCenter(1.35);
$('z-out').onclick = () => renderer.zoomCenter(1 / 1.35);
$('z-fit').onclick = () => { game.follow = false; $('z-follow').classList.remove('active'); renderer.fit(); };
$('z-follow').onclick = () => {
  game.follow = !game.follow;
  $('z-follow').classList.toggle('active', game.follow);
  if (!game.follow) renderer.fit();
};
window.addEventListener('resize', () => { if (game.world) renderer.resize(); });
// a área do mapa muda de tamanho quando a barra de ferramentas abre/fecha
new ResizeObserver(() => { if (game.world && game.mode !== 'menu') { const f = renderer.cam.z <= renderer.fitView().z * 1.02; renderer.resize(); if (f) renderer.fit(); } }).observe($('stage-wrap'));
window.addEventListener('keydown', e => {
  if (game.mode === 'menu') return;
  if (e.key === ' ') { e.preventDefault(); game.mode === 'plan' ? startRun() : $('btn-pause').click(); }
  if (e.key === 'Escape') cancelStroke();
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
  const keys = { 0: 'pan', 1: 'fence', 2: 'gate', 3: 'staff', 4: 'erase' };
  if (keys[e.key]) { const b = document.querySelector(`[data-tool="${keys[e.key]}"]`); if (!b.disabled) selectTool(keys[e.key]); }
  if (e.key === 'h') $('btn-heat').click();
  if (e.key === 'c') $('z-follow').click();
  if (e.key === '+' || e.key === '=') renderer.zoomCenter(1.25);
  if (e.key === '-') renderer.zoomCenter(0.8);
});

// ---------- LAÇO ----------
let previewDirty = false, previewTimer = 0;
let prev = performance.now();
const STEP = 1 / 30;
let acc = 0;
function loop(now) {
  const dt = Math.min(0.1, (now - prev) / 1000);
  prev = now;
  if (game.mode !== 'menu' && game.world) {
    renderer.trackPerf(dt * 1000);
    if (game.mode === 'plan' && previewDirty) {
      previewTimer += dt;
      if (previewTimer > 0.15) { renderer.rebuildPreview(); previewDirty = false; previewTimer = 0; }
    }
    const sim = game.sim;
    if (stroke?.lastEvent && pointers.size === 1) edgePan(stroke.lastEvent, dt);
    if (game.mode === 'run' && sim && !game.paused) {
      // a simulação usa no máximo ~8 ms por quadro; se o aparelho não der conta,
      // a velocidade real cai em vez de a tela travar
      acc += dt * game.speed;
      const t0 = performance.now(), budget = renderer.mobile ? 7 : 9;
      let n = 0;
      while (acc >= STEP && n < 8 && (n === 0 || performance.now() - t0 < budget)) { sim.step(STEP); acc -= STEP; n++; }
      const limited = acc > STEP * 3;
      if (limited) acc = STEP;
      $('btn-speed').classList.toggle('limited', limited && game.speed > 1);
      if (sim.trampled !== game.lastTrampled) {
        game.lastTrampled = sim.trampled;
        updateBadge(sim.trampled); bumpBadge();
        renderer.shake = Math.min(1, renderer.shake + 0.35);
        try { navigator.vibrate?.(30); } catch { /* sem vibração */ }
      }
      if (sim.phaseIdx !== game.lastPhase) {
        game.lastPhase = sim.phaseIdx;
        const ph = sim.phase;
        if (ph && sim.phaseIdx > 0) banner(ph.label.toUpperCase());
        if (ph?.kind === 'hold' && ph.show !== 'match') audio.cheer(0.5);
        if (ph?.kind === 'exit' && game.world.level.pitch) audio.whistle();
        if (ph?.kind === 'exit' && game.world.level.night) for (let k = 0; k < 4; k++) setTimeout(() => audio.boom(), 300 + k * 450);
        if (ph?.kind === 'burst') audio.horn();
        if (ph?.kind === 'follow') audio.cheer(0.45);
      }
      $('phase').textContent = phaseText(sim);
      const risk = Math.min(1, sim.hot.d / (sim.p.dangerDensity * 1.25));
      $('risk-fill').style.width = `${risk * 100}%`;
      $('risk-fill').style.backgroundPosition = '0 0';
      $('risk-val').textContent = sim.hot.d.toFixed(1);
      updateMoney();
      if (sim.done) finish();
    }
    if (sim && game.mode === 'run') {
      const ph = sim.phase;
      audio.update(dt, {
        active: sim.active,
        avgDensity: sim.hot.d * 0.5,
        showing: !!ph && ((ph.kind === 'hold' && ph.show !== 'match') || ph.kind === 'follow'),
        surge: !!sim.surge,
        bpm: game.world.level.parade ? 140 : 124,
      });
    } else audio.update(dt, { active: 0 });
    renderer.frame(game.mode === 'plan' ? null : sim, {
      heat: game.heat,
      preview: game.mode === 'plan' && !stroke,
      tool: canBuild() && !stroke ? game.tool : null,
      follow: game.follow && game.mode === 'run',
    }, dt);
  }
  requestAnimationFrame(loop);
}

showMenu();
requestAnimationFrame(loop);

// atalho de depuração para testes no navegador
window.__pisoteio = { game, renderer, startLevel, startRun, STATE };
