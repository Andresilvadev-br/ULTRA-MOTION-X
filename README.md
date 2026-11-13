# ULTRA-MOTION-X
Next-generation universal motion engine with advanced physics, GPU-accelerated animations, adaptive rendering, intelligent interactions, and AI-native integration for seamless experiences across platforms.

JavaScript puro (ES modules), **sem dependências**, pensado para WebView2/Chromium e
para apps leves (HTML/CSS/JS sem framework). É o motor de movimento do
[OtimizaPC 5.0](https://github.com/Andresilvadev-br/OtimizaPC).

## Recursos

- **Física avançada** — molas com solução analítica exata (mesma trajetória em 60–240 Hz),
  inércia, rastreamento de velocidade e resistência elástica. Interromper ou inverter
  qualquer animação preserva posição e velocidade.
- **Animações aceleradas por GPU** — a trajetória da mola é convertida em keyframes Web
  Animations e roda no compositor; propriedades individuais `translate`/`scale`/`rotate`
  compõem com o CSS existente.
- **Renderização adaptativa** — perfis Ultra/Balanced/Performance, orçamento de efeitos
  decorativos, monitor de ritmo de frames que reduz só a decoração e *sugere* outro perfil.
  Nenhum laço residente: o rAF só existe enquanto há trabalho, e tudo pausa com a janela oculta.
- **Interações inteligentes** — microinterações declarativas (`data-umx-*`) com um listener
  delegado, previsão de intenção do ponteiro e arraste com inércia.
- **Coreografia honesta** — `MotionDirector` liga animações a eventos reais do backend;
  passos que anunciam sucesso só são aceitos depois de uma confirmação (`await`).
- **Integração nativa com IA** — a IA pede intenções declarativas validadas por esquema
  (`guide`, `highlight`, `explain`, `celebrate`…), com limite de taxa; `describe()` expõe o
  estado do movimento para a IA explicar sem inventar.
- **Personagem, tema e efeitos** — máquina de estados de mascote (SVG ou Rive), tema derivado
  da cor do usuário em OKLab com contraste garantido, camada de partículas criada sob demanda,
  cápsula morfável (Dynamic Island) e ponte com o host nativo (WebView2).

## Uso

```js
import { createUltraMotionX } from './src/index.js';

const umx = createUltraMotionX({ accent: '#2f8cff', mode: 'dark' });
await umx.ready;            // perfil salvo carregado (padrão: ultra)
umx.bind(document);         // data-umx-press, data-umx-hover, data-umx-toggle...

umx.animate(card, { y: 0, opacity: 1 }, { spring: 'gentle', from: { y: 12, opacity: 0 } });

umx.director.define('save', {
  on: 'file.save.requested',
  steps: [
    { run: (ctx) => ctx.animate(button, { scale: 0.96 }) },
    { await: 'file.save.confirmed', fail: 'file.save.failed' },
    { announce: 'success', run: (ctx) => showSaved(ctx.confirmed.payload) },
  ],
});
umx.director.dispatch({ type: 'file.save.requested', id: 'f1' });
```

| Módulo | Conteúdo |
| --- | --- |
| `core/` | `MotionScheduler`, estatísticas de frame, emissor |
| `physics/` | molas analíticas, inércia, `VelocityTracker` |
| `animate/` | `Animator` (drivers compositor/frame), `MotionValue` |
| `director/` | `MotionDirector` |
| `transitions/` | FLIP, elementos compartilhados, `TransitionCoordinator` |
| `interactions/` | microinterações, previsão de intenção, arraste |
| `budget/` | perfis e `MotionBudget` |
| `theme/` | cor (OKLab, WCAG) e `ThemeMotionBridge` |
| `character/` | `CharacterStateMachine`, renderizadores SVG e Rive |
| `effects/` | `EffectsLayer` |
| `capsule/` | `CapsuleMorph` |
| `bridge/` | `HostBridge` (WebView2) |
| `ai/` | `MotionIntentBridge` |
| `adapters/` | adaptador GSAP opcional |

## Testes

```bash
npm test
```
