# CLAUDE.md: instruções para o Claude Code

Projeto: **Pisoteio**, um simulador de gestão de multidões para navegador (v0.3).
Leia `docs/PROJETO.md` antes de qualquer mudança grande. Os quadros de referência visual estão em `docs/referencias/` (abra as imagens para entender o clima pretendido).

## Regras do projeto
- **Sem build e sem dependências.** HTML + CSS + ES Modules puros. O site é publicado direto pelo GitHub Pages a partir da raiz da branch `main`.
- **Idioma:** textos de interface, comentários e commits em **português do Brasil**.
- `js/sim.js` **nunca** importa DOM, para continuar rodando no Node (testes headless).
- Mobile first: tudo precisa funcionar por toque numa tela de ~400 px de largura.
- Desempenho: até ~1.500 pessoas a 60 fps num celular médio. Use arrays tipados e evite alocar objetos dentro do laço de passo.
  No desenho, agrupe por cor e faça um `fill()` por lote; nunca crie gradientes por quadro (use `renderer.glow(cor)`).
  Para medir: Playwright com `Emulation.setCPUThrottlingRate` 4 e viewport 390 × 844 com toque.
- O tema é sério: nada de sangue ou violência gráfica (ver seção 8 do PROJETO.md).

## Comandos
```bash
# servidor local
python3 -m http.server 8000   # abrir http://localhost:8000

# calibração das fases (Node 18+)
node tests/headless.mjs              # todas as fases, sem plano do jogador
node tests/headless.mjs 0 patio_bom  # fase 1 com o plano de referência
# planos: patio_bom, festival_bom, reveillon_bom, estadio_bom, carnaval_bom, metro_bom (índices 0–5)
```

## Checklist ao mexer na simulação ou nas fases
1. Rodar `node tests/headless.mjs` antes e depois.
2. Cada fase **sem plano** deve falhar (pisoteados > `maxTrampled`).
3. Cada plano de referência em `tests/headless.mjs` deve passar.
4. Se criar uma fase nova, adicione também um plano de referência que passe. Teste com mais de uma semente: há variação natural.
5. Testar no navegador em largura de celular (DevTools, 390 × 844).

## Arquitetura rápida
- `sim.js`: `World` (mapa, ferramentas, orçamento) → `FlowField` (Dijkstra + direção) → `Simulation` (agentes, densidade, pressão, quedas, fases).
- `levels.js`: fases geradas por funções (`fill`, `zone`, `gate`, `openable`). Campos documentados no topo do arquivo.
- `render.js`: câmera (`cam.x/y/z`, tudo em metros), camada estática em cache, mapa de calor, pessoas com nível de detalhe, efeitos (luzes, confete, fogos, trem, trio) e prévia de fluxo.
- `audio.js`: som procedural (Web Audio). Só inicia depois de um gesto do usuário.
- `main.js`: estados `menu | plan | run | result`, Pointer Events, HUD, laço com passo fixo de 1/30 s.

## Próximas tarefas sugeridas
Veja a seção 7 (Roteiro) do `docs/PROJETO.md`. O v0.3 está feito; comece pelo v0.4 (Web Worker).
