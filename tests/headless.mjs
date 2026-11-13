// Roda as fases sem interface para calibrar a dificuldade.
// Uso: node tests/headless.mjs [indiceDaFase] [plano]
import { World, Simulation } from '../js/sim.js';
import { makeLevel, LEVELS } from '../js/levels.js';

const PLANS = {
  // plano "bom" de referência para a fase 1: portões extras no fundo e nas laterais
  patio_bom(w) {
    for (const x of [3, 4, 5, 15, 16, 19, 20, 30, 31]) w.place('gate', x, 59);
    for (const y of [48, 49]) { w.place('gate', 0, y); w.place('gate', 35, y); }
    // grades de setor na plateia
    for (let x = 1; x < 35; x++) if (x % 9 > 1) w.place('fence', x, 19);
  },
  festival_bom(w) {
    for (const y of [43, 44, 45, 46]) w.place('gate', 35, y);
    for (const x of [6, 7, 8, 9]) w.place('gate', x, 59);
  },
  praca_bom(w) {
    // barreiras nas bocas da praça para segurar a pressão vinda das ruas laterais
    for (let x = 7; x <= 15; x++) w.place('fence', x, 25);
    for (let x = 21; x <= 28; x++) w.place('fence', x, 25);
    for (let x = 7; x <= 15; x++) w.place('fence', x, 35);
    for (let x = 21; x <= 28; x++) w.place('fence', x, 35);
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
