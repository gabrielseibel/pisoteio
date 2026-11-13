# CLAUDE.md: instruções para o Claude Code

Projeto: **Pisoteio**, um simulador de gestão de multidões para navegador (MVP).
Leia `docs/PROJETO.md` antes de qualquer mudança grande. Os quadros de referência visual estão em `docs/referencias/` (abra as imagens para entender o clima pretendido).

## Regras do projeto
- **Sem build e sem dependências.** HTML + CSS + ES Modules puros. O site é publicado direto pelo GitHub Pages a partir da raiz da branch `main`.
- **Idioma:** textos de interface, comentários e commits em **português do Brasil**.
- `js/sim.js` **nunca** importa DOM, para continuar rodando no Node (testes headless).
- Mobile first: tudo precisa funcionar por toque numa tela de ~400 px de largura.
- Desempenho: até ~1.500 pessoas a 60 fps num celular médio. Use arrays tipados e evite alocar objetos dentro do laço de passo.
- O tema é sério: nada de sangue ou violência gráfica (ver seção 8 do PROJETO.md).

## Comandos
```bash
# servidor local
python3 -m http.server 8000   # abrir http://localhost:8000

# calibração das fases (Node 18+)
node tests/headless.mjs              # todas as fases, sem plano do jogador
node tests/headless.mjs 0 patio_bom  # fase 1 com o plano de referência
```

## Checklist ao mexer na simulação ou nas fases
1. Rodar `node tests/headless.mjs` antes e depois.
2. Cada fase **sem plano** deve falhar (pisoteados > `maxTrampled`).
3. Cada plano de referência em `tests/headless.mjs` deve passar.
4. Se criar uma fase nova, adicione também um plano de referência que passe.
5. Testar no navegador em largura de celular (DevTools, 390 × 844).

## Arquitetura rápida
- `sim.js`: `World` (mapa, ferramentas, orçamento) → `FlowField` (Dijkstra + direção) → `Simulation` (agentes, densidade, pressão, quedas, fases).
- `levels.js`: fases geradas por funções (`fill`, `zone`, `gate`). Formato: 36 × 60 células de 1 m.
- `render.js`: camada estática em cache, mais o mapa de calor, as pessoas e a prévia de fluxo por quadro.
- `main.js`: estados `menu | plan | run | result`, Pointer Events, HUD, laço com passo fixo de 1/30 s.

## Próximas tarefas sugeridas
Veja a seção 7 (Roteiro) do `docs/PROJETO.md`. Comece pelo v0.2.
