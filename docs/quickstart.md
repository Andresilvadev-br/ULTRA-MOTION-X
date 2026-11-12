# Quick start

```ts
import { configureEngine, animate, press, autoEnhance } from "@ultra-motion-x/web";

configureEngine({ profile: "fluid" });         // optional: Motion DNA profile
autoEnhance();                                  // semantic motion for common UI roles

const card = document.querySelector(".card")!;
animate(card, { y: [24, 0], opacity: [0, 1] }); // DNA "standard" spring, interruptible
press(document.querySelector("button")!);       // pointer-down feedback, keyboard too

const c = animate(card, { scale: 1.05 }, { spring: "bouncy" });
c.reverse();                                    // physical reversal keeps velocity
await c;                                        // controls are awaitable
```

Simple cases need no parameters: a spring comes from the active profile. Every option is
documented in [api/web.md](api/web.md).

Next: [integration guide](integration.md) for existing apps, [Studio](studio.md) to design
motion visually, [examples](../examples) for complete pages.
