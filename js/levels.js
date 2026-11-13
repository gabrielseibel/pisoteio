// =============================================================
// Fases do MVP. Cada fase é gerada por código (mais fácil de ajustar que ASCII).
// Mapa em células de 1 m. Retrato (36 x 60), igual ao formato do vídeo.
// =============================================================
import { TILE } from './sim.js';

function blank(W, H) {
  const n = W * H;
  const lv = {
    W, H,
    tiles: new Uint8Array(n).fill(TILE.FLOOR),
    zone: new Int8Array(n).fill(-1),
    spawn: new Uint8Array(n),
    decor: [], // elementos só visuais: {type, x, y, w, h}
  };
  // muro no perímetro
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
const zone = (lv, x, y, w, h, z) => rect(lv, x, y, w, h, i => { if (lv.tiles[i] === TILE.FLOOR) lv.zone[i] = z; });
const gate = (lv, x, y, w, h, spawn = true) => rect(lv, x, y, w, h, i => { lv.tiles[i] = TILE.GATE; lv.spawn[i] = spawn ? 1 : 0; });

// ---------------------------------------------------------------
// 1) SHOW NO PÁTIO — referência: docs/referencias/01 e 02
// ---------------------------------------------------------------
function showNoPatio() {
  const lv = blank(36, 60);
  lv.id = 'patio';
  lv.name = 'Show no Pátio';
  lv.brief = 'Um show num pátio murado. O público entra por dois portões estreitos lá embaixo e corre para a frente do palco. No fim, todo mundo quer sair ao mesmo tempo.';
  lv.tip = 'Abra portões extras no muro e use grades para dividir a plateia em setores — a grade segura o empurra-empurra.';
  fill(lv, 7, 1, 22, 6, TILE.STAGE);          // palco
  fill(lv, 16, 7, 4, 3, TILE.STAGE);          // passarela
  fill(lv, 15, 38, 6, 4, TILE.BUILDING);      // mesa de som
  zone(lv, 1, 7, 34, 24, 0);                  // plateia
  gate(lv, 9, 59, 2, 1);                      // portões
  gate(lv, 25, 59, 2, 1);
  lv.crowd = 900;
  lv.spawnRate = 14;
  lv.budget = 420;
  lv.costs = { fence: 4, gate: 45 };
  lv.maxTrampled = 5;
  lv.params = {};
  lv.phases = [
    { kind: 'enter', zone: 0, label: 'Portões abertos', excitement: 1.25, maxTime: 150 },
    { kind: 'hold', zone: 0, duration: 12, label: 'Show!', excitement: 1.45 },
    { kind: 'exit', label: 'Evacuação', maxTime: 240 },
  ];
  return lv;
}

// ---------------------------------------------------------------
// 2) FESTIVAL DE DOIS PALCOS — o público atravessa o campo no meio do evento
// ---------------------------------------------------------------
function doisPalcos() {
  const lv = blank(36, 60);
  lv.id = 'festival';
  lv.name = 'Festival de Dois Palcos';
  lv.brief = 'O show começa no Palco 1. Depois a atração principal sobe no Palco 2, do outro lado do campo, e a multidão inteira atravessa entre as barracas de comida.';
  lv.tip = 'Fluxos que se cruzam viram nó. Crie corredores com grades para a travessia não se chocar com quem ainda está chegando.';
  fill(lv, 2, 1, 14, 5, TILE.STAGE);          // palco 1 (topo esquerdo)
  fill(lv, 20, 54, 14, 5, TILE.STAGE);        // palco 2 (baixo direito)
  // barracas de comida no meio
  fill(lv, 6, 26, 4, 3, TILE.BUILDING);
  fill(lv, 14, 29, 4, 3, TILE.BUILDING);
  fill(lv, 22, 26, 4, 3, TILE.BUILDING);
  fill(lv, 28, 31, 4, 3, TILE.BUILDING);
  fill(lv, 2, 33, 5, 2, TILE.BUILDING);
  zone(lv, 1, 6, 22, 14, 0);
  zone(lv, 13, 40, 22, 14, 1);
  gate(lv, 0, 22, 1, 3);                      // portão oeste
  gate(lv, 35, 22, 1, 3);                     // portão leste
  gate(lv, 0, 46, 1, 2, false);               // saída de emergência
  lv.crowd = 650;
  lv.spawnRate = 10;
  lv.budget = 380;
  lv.costs = { fence: 4, gate: 45 };
  lv.maxTrampled = 15;
  lv.params = {};
  lv.phases = [
    { kind: 'enter', zone: 0, label: 'Público chegando', excitement: 1.2, maxTime: 150 },
    { kind: 'hold', zone: 0, duration: 8, label: 'Show no Palco 1', excitement: 1.3 },
    { kind: 'move', zone: 1, label: 'Todos para o Palco 2!', excitement: 1.3, maxTime: 120 },
    { kind: 'hold', zone: 1, duration: 10, label: 'Atração principal', excitement: 1.5 },
    { kind: 'exit', label: 'Evacuação', maxTime: 240 },
  ];
  return lv;
}

// ---------------------------------------------------------------
// 3) PRAÇA DA CIDADE — referência: docs/referencias/05 e 06
// ---------------------------------------------------------------
function pracaDaCidade() {
  const W = 36, H = 60;
  const lv = blank(W, H);
  lv.id = 'praca';
  lv.name = 'Praça da Cidade';
  lv.brief = 'Réveillon na praça central. O palco fica no meio da cidade e a multidão chega por todas as ruas ao mesmo tempo.';
  lv.tip = 'Você não pode abrir portões aqui. Use grades para criar mão única: umas ruas só para chegar, outras só para sair.';
  // tudo prédio, depois "escava" ruas e praça
  fill(lv, 1, 1, W - 2, H - 2, TILE.BUILDING);
  const vStreets = [4, 16, 28];             // x inicial de ruas verticais (largura 3)
  const hStreets = [5, 17, 39, 51];         // y inicial de ruas horizontais (largura 3)
  for (const x of vStreets) fill(lv, x, 1, 3, H - 2, TILE.FLOOR);
  for (const y of hStreets) fill(lv, 1, y, W - 2, 3, TILE.FLOOR);
  fill(lv, 7, 21, 22, 18, TILE.FLOOR);       // praça
  fill(lv, 15, 28, 6, 4, TILE.STAGE);        // palco no centro
  zone(lv, 7, 21, 22, 18, 0);
  // um parque (obstáculo verde) como no vídeo
  lv.decor.push({ type: 'park', x: 8, y: 9, w: 7, h: 7 });
  // portões nas pontas das ruas
  for (const x of vStreets) { gate(lv, x, 0, 3, 1); gate(lv, x, H - 1, 3, 1); }
  for (const y of hStreets) { gate(lv, 0, y, 1, 3); gate(lv, W - 1, y, 1, 3); }
  lv.crowd = 850;
  lv.spawnRate = 12;
  lv.budget = 260;
  lv.costs = { fence: 4, gate: 9999 };
  lv.noGates = true;
  lv.maxTrampled = 12;
  lv.params = {};
  lv.phases = [
    { kind: 'enter', zone: 0, label: 'A cidade chega', excitement: 1.25, maxTime: 160 },
    { kind: 'hold', zone: 0, duration: 12, label: 'Contagem regressiva!', excitement: 1.5 },
    { kind: 'exit', label: 'Dispersão', maxTime: 260 },
  ];
  return lv;
}

export const LEVELS = [showNoPatio, doisPalcos, pracaDaCidade];
export const makeLevel = i => LEVELS[i]();
