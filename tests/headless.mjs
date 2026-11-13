// Roda as fases sem interface para calibrar a dificuldade.
// Uso: node tests/headless.mjs [indiceDaFase] [plano]
import { World, Simulation } from '../js/sim.js';
import { makeLevel, LEVELS } from '../js/levels.js';

// abre as passagens "abríveis" de uma área (todas as células da área)
function openArea(w, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) w.place('gate', x, y);
}
// abre n passagens abríveis espalhadas pelo mapa
function openSpread(w, n) {
  const cells = [];
  for (let i = 0; i < w.openable.length; i++) if (w.openable[i]) cells.push(i);
  const step = Math.max(1, Math.floor(cells.length / n));
  for (let k = 0; k < cells.length && n > 0; k += step) {
    if (w.place('gate', cells[k] % w.W, (cells[k] / w.W) | 0)) n--;
  }
}

const PLANS = {
  // plano "bom" de referência para a fase 1: portões extras no fundo e nas laterais
  patio_bom(w) {
    // portões extras no fundo, seguranças na frente do palco e uma grade de setor
    for (const x of [4, 5, 15, 16, 30, 31]) w.place('gate', x, 59);
    for (const [x, y] of [[13, 11], [23, 11], [10, 54], [26, 54]]) w.place('staff', x, y);
    for (let x = 1; x < 35; x++) if (x % 8 > 2) w.place('fence', x, 20);
  },
  festival_bom(w) {
    for (const y of [43, 44, 45, 46]) w.place('gate', 35, y);
    for (const x of [6, 7, 8, 9]) w.place('gate', x, 59);
    for (const [x, y] of [[12, 34], [20, 36], [17, 24]]) w.place('staff', x, y);
  },
  estadio_bom(w) {
    openSpread(w, 9);
  },
  carnaval_bom(w) {
    openArea(w, 14, 54, 14, 57); openArea(w, 25, 54, 25, 57);
    for (const [x, y] of [[13, 46], [26, 46], [20, 44], [14, 30], [25, 30]]) w.place('staff', x, y);
  },
  metro_bom(w) {
    openArea(w, 24, 15, 27, 15);           // reabre a escada do meio
    for (const x of [9, 12, 39, 42]) w.place('gate', x, 29); // catracas extras
    w.place('staff', 25, 12);
  },
  praca_bom(w) {
    // barreiras nas bocas da praça para segurar a pressão vinda das ruas laterais
    for (let x = 7; x <= 15; x++) w.place('fence', x, 25);
    for (let x = 21; x <= 28; x++) w.place('fence', x, 25);
    for (let x = 7; x <= 15; x++) w.place('fence', x, 35);
    for (let x = 21; x <= 28; x++) w.place('fence', x, 35);
  },
  reveillon_bom(w) {
    // seguranças nas bocas das ruas que chegam na praça
    for (const [x, y] of [[19, 27], [36, 27], [19, 56], [36, 56], [13, 33], [42, 33], [13, 50], [42, 50], [27, 36], [28, 46]]) w.place('staff', x, y);
  },
};

function run(i, planName) {
  const lv = makeLevel(i);
  const w = new World(lv);
  if (planName && PLANS[planName]) PLANS[planName](w);
  const sim = new Simulation(w, 7);
  const dt = 1 / 30;
  const t0 = Date.now();
  let lastPhase = -1;
  while (!sim.done && sim.time < 900) {
    sim.step(dt);
    if (sim.phaseIdx !== lastPhase) {
      lastPhase = sim.phaseIdx;
      const ph = sim.phases[sim.phaseIdx];
      console.log(`  t=${sim.time.toFixed(1)}s fase→ ${ph ? ph.label : 'fim'} | pisoteados=${sim.trampled}`);
    }
  }
  const r = sim.result();
  console.log(`[${lv.name}${planName ? ' / ' + planName : ''}] pisoteados=${r.trampled}/${lv.maxTrampled} estrelas=${r.stars} saíram=${r.exited} tempo=${r.time.toFixed(0)}s pico=${r.peak.toFixed(2)}p/m² cpu=${Date.now() - t0}ms dinheiro=${w.money}`);
}

const only = process.argv[2];
const plan = process.argv[3];
if (only !== undefined) run(+only, plan);
else for (let i = 0; i < LEVELS.length; i++) run(i);
