// =============================================================
// PISOTEIO — interface, entrada e laço do jogo
// =============================================================
import { World, Simulation } from './sim.js';
import { LEVELS, makeLevel } from './levels.js';
import { Renderer } from './render.js';

const $ = id => document.getElementById(id);
const canvas = $('view');
const renderer = new Renderer(canvas);

const game = {
  levelIdx: 0,
  world: null,
  sim: null,
  mode: 'menu',      // menu | plan | run | result
  tool: 'fence',
  speed: 1,
  paused: false,
  heat: true,
  lastTrampled: 0,
  lastPhase: -1,
};

// ---------- progresso salvo (localStorage pode falhar em alguns contextos) ----------
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
    b.innerHTML = `<div class="num">${i + 1}</div>
      <div class="info"><div class="name">${lv.name}</div>
      <div class="sub">${lv.crowd} pessoas · limite ${lv.maxTrampled} pisoteados</div></div>
      <div class="stars">${starStr(stars[lv.id] || 0)}</div>`;
    b.onclick = () => startLevel(i);
    list.appendChild(b);
  });
}

// ---------- FASE ----------
function startLevel(i) {
  game.levelIdx = i;
  game.world = new World(makeLevel(i));
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
  game.lastTrampled = 0;
  game.lastPhase = -1;
  const lv = game.world.level;
  $('level-name').textContent = `${game.levelIdx + 1}. ${lv.name}`;
  $('phase').textContent = 'Planejamento — monte o espaço';
  $('cost-fence').textContent = `R$ ${lv.costs.fence}`;
  $('cost-gate').textContent = lv.noGates ? 'bloqueado' : `R$ ${lv.costs.gate}`;
  document.querySelector('[data-tool="gate"]').disabled = !!lv.noGates;
  $('plan-tools').classList.remove('hidden');
  $('run-tools').classList.add('hidden');
  $('btn-start').disabled = false;
  $('btn-start').textContent = '▶ Começar';
  $('limit').textContent = `Limite: ${lv.maxTrampled} · ${lv.crowd} pessoas`;
  updateBadge(0);
  updateMoney();
  renderer.rebuildPreview();
  if (withBrief) showBrief(); else banner('VOCÊ PLANEJA');
}

function showBrief() {
  const lv = game.world.level;
  showModal(lv.name, `
    <p>${lv.brief}</p>
    <div class="goal">
      <div><b>${lv.crowd}</b><span>pessoas</span></div>
      <div><b>≤ ${lv.maxTrampled}</b><span>pisoteados para passar</span></div>
    </div>
    <p class="tip">💡 ${lv.tip}</p>
    <p style="font-size:13px;color:#a3a6ad">As linhas coloridas mostram por onde o público vai passar. Toque e arraste no mapa para construir.</p>`,
    [{ label: 'Planejar', primary: true, fn: () => { hideModal(); banner('VOCÊ PLANEJA'); } }]);
}

function startRun() {
  if (game.mode !== 'plan') return;
  game.mode = 'run';
  game.paused = false;
  // a simulação trabalha sobre uma cópia do mundo planejado
  game.sim = new Simulation(game.world, (Math.random() * 1e9) | 0);
  $('plan-tools').classList.add('hidden');
  $('run-tools').classList.remove('hidden');
  $('btn-start').disabled = true;
  $('btn-start').textContent = 'Rodando…';
  setSpeed(game.speed);
  banner('ELES CHEGAM');
}

function finish() {
  game.mode = 'result';
  const r = game.sim.result();
  const lv = game.world.level;
  if (r.passed) saveStars(lv.id, r.stars);
  const next = game.levelIdx + 1 < LEVELS.length;
  const title = r.passed ? (r.stars === 3 ? 'Evento perfeito!' : 'Evento concluído') : 'Tragédia';
  const msg = r.passed
    ? (r.stars === 3 ? 'Ninguém se machucou. Todo mundo foi para casa.' : 'Passou, mas dá para fazer melhor.')
    : 'O espaço não aguentou a multidão. Observe onde o mapa ficou vermelho e replaneje.';
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
      <div><b>${formatTime(r.time)}</b><span>duração do evento</span></div>
    </div>`, actions);
}

// ---------- HUD ----------
function updateMoney() { $('money').textContent = game.world.money; }
function updateBadge(n) {
  const b = $('badge');
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
const formatTime = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function phaseText(sim) {
  const ph = sim.phase;
  if (!ph) return 'Fim do evento';
  if (ph.kind === 'enter') return `${ph.label} · ${sim.spawned}/${sim.N} dentro`;
  if (ph.kind === 'move') return `${ph.label} · ${sim.inZone || 0} chegaram`;
  if (ph.kind === 'hold') return `${ph.label} · ${Math.max(0, Math.ceil(ph.duration - sim.phaseTime))}s`;
  return `${ph.label} · ${sim.exited} saíram`;
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

// ---------- ENTRADA (mouse e toque) ----------
let painting = false, last = null, paintTool = null;
function applyAt(cx, cy) {
  const w = game.world;
  if (w.place(paintTool, cx, cy)) {
    renderer.drawStatic();
    updateMoney();
    previewDirty = true;
  }
}
function lineCells(a, b, fn) { // Bresenham
  let x0 = a.x, y0 = a.y; const x1 = b.x, y1 = b.y;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    fn(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointerdown', e => {
  if (game.mode !== 'plan') return;
  canvas.setPointerCapture(e.pointerId);
  painting = true;
  paintTool = e.button === 2 ? 'erase' : game.tool;
  last = renderer.cellAt(e.clientX, e.clientY);
  applyAt(last.x, last.y);
});
canvas.addEventListener('pointermove', e => {
  const c = renderer.cellAt(e.clientX, e.clientY);
  renderer.hover = c;
  if (!painting || game.mode !== 'plan') return;
  if (last && (c.x !== last.x || c.y !== last.y)) lineCells(last, c, applyAt);
  last = c;
});
const stopPaint = () => { painting = false; last = null; };
canvas.addEventListener('pointerup', stopPaint);
canvas.addEventListener('pointercancel', stopPaint);
canvas.addEventListener('pointerleave', () => { renderer.hover = null; });

// ---------- BOTÕES ----------
document.querySelectorAll('.tool').forEach(b => b.addEventListener('click', () => {
  if (b.disabled) return;
  game.tool = b.dataset.tool;
  document.querySelectorAll('.tool').forEach(x => x.classList.toggle('active', x === b));
}));
function setSpeed(v) {
  game.speed = v;
  document.querySelectorAll('[data-speed]').forEach(x => x.classList.toggle('active', +x.dataset.speed === v && !game.paused));
}
document.querySelectorAll('[data-speed]').forEach(b => b.addEventListener('click', () => {
  game.paused = false; $('btn-pause').classList.remove('active'); setSpeed(+b.dataset.speed);
}));
$('btn-pause').onclick = () => {
  game.paused = !game.paused;
  $('btn-pause').classList.toggle('active', game.paused);
  setSpeed(game.speed);
};
$('btn-heat').onclick = () => { game.heat = !game.heat; $('btn-heat').classList.toggle('active', game.heat); };
$('btn-start').onclick = startRun;
$('btn-reset').onclick = () => { if (game.mode !== 'menu') { hideModal(); enterPlan(false); } };
$('btn-back').onclick = showMenu;
window.addEventListener('resize', () => { if (game.world) renderer.resize(); });
window.addEventListener('keydown', e => {
  if (game.mode === 'menu') return;
  if (e.key === ' ') { e.preventDefault(); game.mode === 'plan' ? startRun() : $('btn-pause').click(); }
  if (e.key === '1') document.querySelector('[data-tool="fence"]').click();
  if (e.key === '2') document.querySelector('[data-tool="gate"]').click();
  if (e.key === '3') document.querySelector('[data-tool="erase"]').click();
  if (e.key === 'h') $('btn-heat').click();
});

// ---------- LAÇO ----------
let previewDirty = false, previewTimer = 0;
let prev = performance.now();
const STEP = 1 / 30;
let acc = 0;
function loop(now) {
  const dt = Math.min(0.1, (now - prev) / 1000);
  prev = now;
  if (game.mode === 'plan' || game.mode === 'run' || game.mode === 'result') {
    if (game.mode === 'plan' && previewDirty) {
      previewTimer += dt;
      if (previewTimer > 0.15) { renderer.rebuildPreview(); previewDirty = false; previewTimer = 0; }
    }
    const sim = game.sim;
    if (game.mode === 'run' && sim && !game.paused) {
      acc += dt * game.speed;
      let n = 0;
      while (acc >= STEP && n < 12) { sim.step(STEP); acc -= STEP; n++; }
      if (acc > STEP * 4) acc = 0; // máquina lenta: não acumula atraso
      if (sim.trampled !== game.lastTrampled) {
        game.lastTrampled = sim.trampled;
        updateBadge(sim.trampled); bumpBadge();
        renderer.shake = Math.min(1, renderer.shake + 0.35);
      }
      if (sim.phaseIdx !== game.lastPhase) {
        game.lastPhase = sim.phaseIdx;
        if (sim.phase && sim.phaseIdx > 0) banner(sim.phase.label.toUpperCase());
      }
      $('phase').textContent = phaseText(sim);
      if (sim.done) finish();
    }
    renderer.frame(game.mode === 'plan' ? null : sim, {
      heat: game.heat,
      preview: game.mode === 'plan',
      tool: game.mode === 'plan' ? game.tool : null,
    }, dt);
  }
  requestAnimationFrame(loop);
}

showMenu();
requestAnimationFrame(loop);

// atalho de depuração para testes no navegador
window.__pisoteio = { game, startLevel, startRun };
