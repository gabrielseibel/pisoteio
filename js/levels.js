// =============================================================
// Fases. Cada fase é gerada por código (mais fácil de ajustar que ASCII).
// Mapa em células de 1 m.
//
// Campos de uma fase:
//   W, H, tiles, zone, spawn       — mapa
//   openable                       — paredes internas que a ferramenta "portão" abre
//   doors                          — células de desembarque (metrô)
//   parade {path, speed, radius}   — trio elétrico que anda pelo percurso
//   crowd, spawnRate, budget, costs {fence, gate, staff}, tools, noGates
//   maxTrampled, night, phases[]
//   phases: enter | fill | hold | move | follow | burst | exit  (ver sim.js)
//   phase.show: concert | countdown | match | carnival  (efeitos visuais)
// =============================================================
import { TILE } from './sim.js';

function blank(W, H) {
  const n = W * H;
  const lv = {
    W, H,
    tiles: new Uint8Array(n).fill(TILE.FLOOR),
    zone: new Int8Array(n).fill(-1),
    spawn: new Uint8Array(n),
    openable: new Uint8Array(n),
    decor: [], // elementos só visuais: {type, x, y, w, h}
    params: {},
    tools: ['fence', 'gate', 'staff'],
  };
  for (let x = 0; x < W; x++) { lv.tiles[x] = TILE.WALL; lv.tiles[(H - 1) * W + x] = TILE.WALL; }
  for (let y = 0; y < H; y++) { lv.tiles[y * W] = TILE.WALL; lv.tiles[y * W + W - 1] = TILE.WALL; }
  return lv;
}
function rect(lv, x, y, w, h, fn) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
    if (i < 0 || j < 0 || i >= lv.W || j >= lv.H) continue;
    fn(j * lv.W + i, i, j);
  }
}
const fill = (lv, x, y, w, h, t) => rect(lv, x, y, w, h, i => { lv.tiles[i] = t; });
const zone = (lv, x, y, w, h, z) => rect(lv, x, y, w, h, i => {
  const t = lv.tiles[i];
  if (t === TILE.FLOOR || t === TILE.GRASS || t === TILE.SEATS) lv.zone[i] = z;
});
const gate = (lv, x, y, w, h, spawn = true) => rect(lv, x, y, w, h, i => { lv.tiles[i] = TILE.GATE; lv.spawn[i] = spawn ? 1 : 0; });
const openable = (lv, x, y, w, h) => rect(lv, x, y, w, h, i => { lv.tiles[i] = TILE.BUILDING; lv.openable[i] = 1; });

// ---------------------------------------------------------------
// 1) SHOW NO PÁTIO — referência: docs/referencias/01 e 02
// ---------------------------------------------------------------
function showNoPatio() {
  const lv = blank(36, 60);
  lv.id = 'patio';
  lv.name = 'Show no Pátio';
  lv.icon = '🎤';
  lv.brief = 'Um show num pátio murado. O público entra por dois portões estreitos lá embaixo e corre para a frente do palco. A cada "drop" da música a plateia empurra para a frente. No fim, todo mundo quer sair ao mesmo tempo.';
  lv.tip = 'Abra portões extras no muro e use grades para dividir a plateia em setores: a grade segura o empurra-empurra das ondas de euforia.';
  fill(lv, 7, 1, 22, 6, TILE.STAGE);
  fill(lv, 16, 7, 4, 3, TILE.STAGE);
  fill(lv, 15, 38, 6, 4, TILE.BUILDING);
  lv.decor.push({ type: 'mixer', x: 15, y: 38, w: 6, h: 4 });
  zone(lv, 1, 7, 34, 24, 0);
  gate(lv, 9, 59, 2, 1);
  gate(lv, 25, 59, 2, 1);
  lv.crowd = 900;
  lv.spawnRate = 14;
  lv.budget = 480;
  lv.costs = { fence: 4, gate: 45, staff: 30 };
  lv.maxTrampled = 8;
  lv.phases = [
    { kind: 'enter', zone: 0, label: 'Portões abertos', excitement: 1.25, maxTime: 150 },
    { kind: 'hold', zone: 0, duration: 16, label: 'Show!', excitement: 1.4, show: 'concert' },
    { kind: 'exit', label: 'Evacuação', maxTime: 240 },
  ];
  return lv;
}

// ---------------------------------------------------------------
// 2) FESTIVAL DE DOIS PALCOS
// ---------------------------------------------------------------
function doisPalcos() {
  const lv = blank(36, 60);
  lv.id = 'festival';
  lv.name = 'Festival de Dois Palcos';
  lv.icon = '🎪';
  lv.brief = 'O show começa no Palco 1. Depois a atração principal sobe no Palco 2, do outro lado do campo, e a multidão inteira atravessa entre as barracas de comida.';
  lv.tip = 'Fluxos que se cruzam viram nó. Crie corredores com grades e ponha seguranças onde a travessia aperta.';
  fill(lv, 2, 1, 14, 5, TILE.STAGE);
  fill(lv, 20, 54, 14, 5, TILE.STAGE);
  for (const [x, y, w, h] of [[6, 26, 4, 3], [14, 29, 4, 3], [22, 26, 4, 3], [28, 31, 4, 3], [2, 33, 5, 2]]) {
    fill(lv, x, y, w, h, TILE.BUILDING);
    lv.decor.push({ type: 'tent', x, y, w, h });
  }
  fill(lv, 24, 8, 10, 10, TILE.GRASS);
  zone(lv, 1, 6, 22, 14, 0);
  zone(lv, 13, 40, 22, 14, 1);
  gate(lv, 0, 22, 1, 3);
  gate(lv, 35, 22, 1, 3);
  gate(lv, 0, 46, 1, 2, false);
  lv.crowd = 650;
  lv.spawnRate = 10;
  lv.budget = 420;
  lv.costs = { fence: 4, gate: 45, staff: 30 };
  lv.maxTrampled = 22;
  lv.phases = [
    { kind: 'enter', zone: 0, label: 'Público chegando', excitement: 1.2, maxTime: 150 },
    { kind: 'hold', zone: 0, duration: 10, label: 'Show no Palco 1', excitement: 1.3, show: 'concert' },
    { kind: 'move', zone: 1, label: 'Todos para o Palco 2!', excitement: 1.3, maxTime: 120 },
    { kind: 'hold', zone: 1, duration: 14, label: 'Atração principal', excitement: 1.45, show: 'concert' },
    { kind: 'exit', label: 'Evacuação', maxTime: 240 },
  ];
  return lv;
}

// ---------------------------------------------------------------
// 3) RÉVEILLON NA PRAÇA — cidade à noite (referência: quadros 05 e 06)
// ---------------------------------------------------------------
function reveillon() {
  const W = 56, H = 84;
  const lv = blank(W, H);
  lv.id = 'praca';
  lv.name = 'Réveillon na Praça';
  lv.icon = '🎆';
  lv.night = true;
  lv.brief = 'Virada do ano na praça central. A cidade inteira chega por oito ruas ao mesmo tempo, espera a contagem regressiva e depois se dispersa.';
  lv.tip = 'Aqui não dá para abrir portões. Grades criam mão única nas ruas; seguranças nas esquinas da praça seguram o pânico quando alguém cai.';
  fill(lv, 1, 1, W - 2, H - 2, TILE.BUILDING);
  const vStreets = [5, 18, 34, 47];
  const hStreets = [6, 22, 58, 74];
  for (const x of vStreets) fill(lv, x, 1, 4, H - 2, TILE.FLOOR);
  for (const y of hStreets) fill(lv, 1, y, W - 2, 4, TILE.FLOOR);
  fill(lv, 12, 26, 32, 32, TILE.FLOOR);      // praça
  fill(lv, 24, 38, 8, 6, TILE.STAGE);        // palco no centro
  zone(lv, 12, 26, 32, 32, 0);
  fill(lv, 23, 10, 11, 12, TILE.GRASS);      // parque (dá para cortar caminho, mais devagar)
  lv.decor.push({ type: 'park', x: 23, y: 10, w: 11, h: 12 });
  for (const x of vStreets) { gate(lv, x + 1, 0, 2, 1); gate(lv, x + 1, H - 1, 2, 1); }
  for (const y of hStreets) { gate(lv, 0, y + 1, 1, 2); gate(lv, W - 1, y + 1, 1, 2); }
  lv.crowd = 1300;
  lv.spawnRate = 20;
  lv.budget = 360;
  lv.costs = { fence: 4, gate: 9999, staff: 30 };
  lv.tools = ['fence', 'staff'];
  lv.noGates = true;
  lv.maxTrampled = 8;
  lv.phases = [
    { kind: 'enter', zone: 0, label: 'A cidade chega', excitement: 1.25, maxTime: 170 },
    { kind: 'hold', zone: 0, duration: 15, label: '10… 9… 8…', excitement: 1.5, show: 'countdown' },
    { kind: 'exit', label: 'Feliz ano novo! Dispersão', maxTime: 260 },
  ];
  return lv;
}

// ---------------------------------------------------------------
// 4) CLÁSSICO NO ESTÁDIO — saída depois do jogo (referência: quadro 07)
// ---------------------------------------------------------------
function estadio() {
  const W = 64, H = 76;
  const lv = blank(W, H);
  lv.id = 'estadio';
  lv.name = 'Clássico no Estádio';
  lv.icon = '⚽';
  lv.brief = 'Fim do clássico. A torcida já está sentada e faz o mosaico. Quando o juiz apita, todos descem as arquibancadas, passam pelos vomitórios e saem pelos portões do estádio.';
  lv.tip = 'O gargalo está nos vomitórios e nos portões. Abra passagens extras nas paredes marcadas e ponha seguranças onde as filas se encontram.';
  const px0 = 22, py0 = 22, px1 = 42, py1 = 54; // campo [px0,px1) x [py0,py1)
  const dRect = (x, y) => {
    const dx = Math.max(px0 - x - 0.5, 0, x + 0.5 - px1);
    const dy = Math.max(py0 - y - 0.5, 0, y + 0.5 - py1);
    return Math.max(dx, dy);
  };
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    const d = dRect(x, y);
    if (d <= 0) lv.tiles[i] = TILE.PITCH;
    else if (d <= 1.5) lv.tiles[i] = TILE.BUILDING;             // fosso/alambrado
    else if (d <= 10.5) {
      // arquibancada com escadas radiais
      const side = (x + 0.5 < px0 || x + 0.5 > px1) && !(y + 0.5 < py0 || y + 0.5 > py1);
      const aisle = side ? (y % 7 === 3) : (x % 7 === 3);
      lv.tiles[i] = aisle ? TILE.STAIRS : TILE.SEATS;
      if (!aisle) lv.zone[i] = 0;
    } else if (d <= 11.5) lv.tiles[i] = TILE.BUILDING;          // parede interna (vomitórios)
    else if (d <= 15.5) lv.tiles[i] = TILE.FLOOR;               // corredor de circulação
    else if (d <= 16.5) lv.tiles[i] = TILE.BUILDING;            // fachada do estádio
  }
  // vomitórios: aberturas na parede interna alinhadas com as escadas
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, d = dRect(x, y);
    if (d > 10.5 && d <= 11.5) {
      const side = (x + 0.5 < px0 || x + 0.5 > px1) && !(y + 0.5 < py0 || y + 0.5 > py1);
      const k = side ? y : x;
      if (k % 14 === 3) lv.tiles[i] = TILE.FLOOR;
      else if (k % 14 === 10) lv.openable[i] = 1;               // vomitório fechado
    }
    if (d > 15.5 && d <= 16.5) {
      const side = (x + 0.5 < px0 || x + 0.5 > px1) && !(y + 0.5 < py0 || y + 0.5 > py1);
      const k = side ? y : x;
      if (k % 21 === 10) lv.tiles[i] = TILE.FLOOR; // portões do estádio
      else if (k % 21 === 3 || k % 21 === 17 || k % 21 === 11) lv.openable[i] = 1;
    }
  }
  lv.pitch = { x: px0, y: py0, w: px1 - px0, h: py1 - py0 };
  // saídas no limite do mapa (esplanada → rua)
  for (const x of [8, 9, 10, 30, 31, 32, 33, 52, 53, 54]) { gate(lv, x, 0, 1, 1, false); gate(lv, x, H - 1, 1, 1, false); }
  for (const y of [12, 13, 14, 36, 37, 38, 39, 60, 61, 62]) { gate(lv, 0, y, 1, 1, false); gate(lv, W - 1, y, 1, 1, false); }
  lv.crowd = 1700;
  lv.budget = 400;
  lv.costs = { fence: 4, gate: 40, staff: 30 };
  lv.maxTrampled = 5;
  lv.phases = [
    { kind: 'fill', zone: 0, label: 'Estádio lotado' },
    { kind: 'hold', zone: 0, duration: 12, label: 'Mosaico da torcida!', excitement: 1.0, show: 'match' },
    { kind: 'exit', label: 'Apito final! Saída', maxTime: 320 },
  ];
  return lv;
}

// ---------------------------------------------------------------
// 5) BLOCO DE CARNAVAL — o trio elétrico arrasta a multidão pela avenida
// ---------------------------------------------------------------
function carnaval() {
  const W = 40, H = 104;
  const lv = blank(W, H);
  lv.id = 'carnaval';
  lv.name = 'Bloco de Carnaval';
  lv.icon = '🎺';
  lv.brief = 'O trio elétrico desce a avenida e a multidão vai junto, espremida em volta do caminhão. No meio do percurso, a avenida estreita embaixo de um viaduto.';
  lv.tip = 'Ninguém para um bloco. Ponha seguranças antes do viaduto e use grades nas ruas laterais para dar espaço de fuga sem gerar contrafluxo.';
  fill(lv, 1, 1, W - 2, H - 2, TILE.BUILDING);
  fill(lv, 11, 1, 18, H - 2, TILE.FLOOR);                // avenida (18 m)
  for (const y of [14, 36, 72, 90]) {                    // ruas transversais
    fill(lv, 1, y, W - 2, 4, TILE.FLOOR);
    gate(lv, 0, y + 1, 1, 2); gate(lv, W - 1, y + 1, 1, 2);
  }
  // viaduto: pilares estreitam a avenida para 10 m
  fill(lv, 11, 50, 4, 12, TILE.BUILDING);
  fill(lv, 25, 50, 4, 12, TILE.BUILDING);
  lv.decor.push({ type: 'overpass', x: 1, y: 52, w: W - 2, h: 8 });
  // rotas de fuga sob o viaduto, fechadas por um tapume que o jogador pode abrir
  fill(lv, 1, 54, 13, 4, TILE.FLOOR); openable(lv, 14, 54, 1, 4);
  fill(lv, 26, 54, 13, 4, TILE.FLOOR); openable(lv, 25, 54, 1, 4);
  gate(lv, 0, 55, 1, 2, false); gate(lv, W - 1, 55, 1, 2, false);
  gate(lv, 15, 0, 10, 1);                                // começo da avenida
  gate(lv, 15, H - 1, 10, 1, false);                     // fim da avenida
  zone(lv, 11, 4, 18, 34, 0);
  lv.parade = { path: [[20, 22], [20, 94]], speed: 0.75, radius: 2.4 };
  lv.crowd = 1400;
  lv.spawnRate = 22;
  lv.budget = 380;
  lv.costs = { fence: 4, gate: 25, staff: 30 };
  lv.noGates = true;
  lv.maxTrampled = 16;
  lv.phases = [
    { kind: 'enter', zone: 0, label: 'Concentração do bloco', excitement: 1.1, maxTime: 120 },
    { kind: 'follow', label: 'O trio saiu!', excitement: 1.4, maxTime: 260, show: 'carnival' },
    { kind: 'exit', label: 'Fim do desfile: dispersão', maxTime: 260 },
  ];
  return lv;
}

// ---------------------------------------------------------------
// 6) ESTAÇÃO DE METRÔ — trens lotados chegam em sequência
// ---------------------------------------------------------------
function metro() {
  const W = 52, H = 40;
  const lv = blank(W, H);
  lv.id = 'metro';
  lv.name = 'Estação na Hora do Rush';
  lv.icon = '🚇';
  lv.indoor = true;
  lv.brief = 'Hora do rush. A cada poucos segundos chega um trem lotado e despeja centenas de passageiros na plataforma. Eles sobem as escadas, passam pelas catracas e saem para a rua. Se a plataforma não esvaziar antes do próximo trem, a pressão se acumula.';
  lv.tip = 'Abra as escadas interditadas e liberte catracas extras. Seguranças no pé das escadas acalmam o empurra-empurra.';
  fill(lv, 1, 1, W - 2, 4, TILE.TRACK);                  // trilho
  // plataforma y 5..14
  fill(lv, 1, 15, W - 2, 7, TILE.BUILDING);              // laje entre plataforma e mezanino
  for (const x of [10, 38]) fill(lv, x, 15, 4, 7, TILE.STAIRS);         // escadas abertas
  for (const x of [3, 24, 45]) { fill(lv, x, 15, 4, 7, TILE.STAIRS); openable(lv, x, 15, 4, 1); } // interditadas
  // mezanino y 22..38, catracas na linha 29
  fill(lv, 1, 29, W - 2, 1, TILE.BUILDING);
  for (let x = 2; x < W - 2; x++) {
    if (x % 3 !== 0) continue;
    const i = 29 * W + x;
    if (x >= 15 && x <= 36) lv.tiles[i] = TILE.FLOOR; else lv.openable[i] = 1; // catracas
  }
  lv.decor.push({ type: 'turnstiles', y: 29 });
  lv.decor.push({ type: 'train', y: 1, h: 4 });
  for (const x of [12, 13, 25, 26, 38, 39]) gate(lv, x, H - 1, 1, 1, false);   // saídas para a rua
  lv.doors = [];
  for (let x = 3; x < W - 3; x++) if (x % 6 === 3 || x % 6 === 4) lv.doors.push(5 * W + x);
  lv.openTo = TILE.FLOOR;
  lv.crowd = 1150;
  lv.budget = 320;
  lv.costs = { fence: 4, gate: 40, staff: 30 };
  lv.noGates = true;
  lv.maxTrampled = 5;
  lv.phases = [];
  for (let k = 1; k <= 5; k++) lv.phases.push({ kind: 'burst', count: 230, unload: 4, interval: 14, label: `Trem ${k} chegou` });
  lv.phases.push({ kind: 'exit', label: 'Último trem: esvaziar', maxTime: 240 });
  return lv;
}

export const LEVELS = [showNoPatio, doisPalcos, reveillon, estadio, carnaval, metro];
export const makeLevel = i => LEVELS[i]();
