# Motion Design Language (MDL) — quick reference

Version string: `"umx/1"`. Times in **milliseconds**. JSON Schema: `docs/schema/mdl-1.schema.json`.

```json
{
  "version": "umx/1",
  "profile": "fluid",
  "tokens": { "spring": { "panel": { "stiffness": 380, "damping": 34 } }, "duration": { "toast": 240 }, "easing": { "brand": [0.2, 0, 0, 1] } },
  "transitions": { "panel": { "type": "spring", "spring": "$spring.panel" } },
  "components": {
    "drawer": {
      "role": "drawer", "priority": "interaction",
      "properties": { "x": { "initial": -320, "min": -360, "max": 0, "unit": "px" }, "scrim": { "initial": 0 } },
      "states": { "closed": { "x": -320 }, "open": { "x": 0 } },
      "initial": "closed",
      "transition": "$transitions.panel",
      "transitions": [{ "from": "closed", "to": "open", "on": "toggle" }, { "from": "open", "to": "closed", "on": "toggle" }],
      "relations": [{ "source": "x", "target": "scrim", "input": [-320, 0], "output": [0, 0.45] }],
      "gestures": { "drag": { "property": "x", "bounds": [-320, 0], "snapTo": ["closed", "open"] } }
    }
  },
  "timelines": { "intro": { "labels": { "content": 200 }, "tracks": [{ "target": "drawer.x", "to": 0, "at": "content+=50" }] } },
  "effects": { "glass": { "material": "glass", "intensity": 0.6 } },
  "performance": { "fidelity": { "min": 1, "max": 4, "initial": 3 }, "budgetFraction": 0.5 },
  "accessibility": { "reducedMotion": "user" }
}
```

- Transition values: `"$spring.<token>"`, `"$transitions.<name>"`, `"instant"`, or objects with
  `type` `spring` (`stiffness/damping/mass` | `response/dampingRatio` | `duration/bounce`, `clamp`,
  `maxOscillations`), `tween` (`duration`, `easing`, `delay`), `keyframes` (`values`, `offsets`,
  `easing`, `duration`), `decay` (`timeConstant`).
- Easings: CSS names (`ease`, `easeOut`, …), `standard`, `emphasized`, `backOut`, `[x1,y1,x2,y2]`,
  `{ "steps": n }`, `{ "linear": [..] }`, `"$easing.<token>"`.
- Transition `interrupt`: `retarget` (default, velocity preserved), `queue`, `ignore`, `snap`.
- Timeline `at`: ms number, `"+=ms"`, `"-=ms"`, `"<"`, `"<+=ms"`, `"label"`, `"label+=ms"`.
- Errors carry codes (`E_UNKNOWN_STATE`, `E_REF_CYCLE`, `E_CYCLE`, `E_OWNERSHIP`, …) and JSON paths.
- Older `umx/0` documents (variants, tension/friction, seconds) migrate automatically; rewrite with `umx migrate --write`.
