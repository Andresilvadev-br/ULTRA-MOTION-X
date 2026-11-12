/**
 * @ultra-motion-x/svelte — Svelte actions. Actions are plain functions returning
 * `{ update, destroy }`, so no Svelte dependency is needed.
 *
 *   <button use:press>Save</button>
 *   <div use:drag={{ axis: "x", bounds: "parent" }} />
 *   <ul use:layout={items}>{#each items as i (i.id)}<li>{i.name}</li>{/each}</ul>
 */
import {
  type DragOptions,
  drag as dragImpl,
  enter as enterImpl,
  hover as hoverImpl,
  LayoutTracker,
  press as pressImpl,
  type SemanticRole,
  tilt as tiltImpl,
} from "@ultra-motion-x/web";

export interface ActionReturn<P> {
  update?: (p: P) => void;
  destroy?: () => void;
}

export function press(node: HTMLElement, opts: { scale?: number } = {}): ActionReturn<{ scale?: number }> {
  let off = pressImpl(node, opts);
  return {
    update(p) {
      off();
      off = pressImpl(node, p);
    },
    destroy: () => off(),
  };
}

export function hover(
  node: HTMLElement,
  opts: { lift?: number; scale?: number } = {},
): ActionReturn<{ lift?: number; scale?: number }> {
  let off = hoverImpl(node, opts);
  return {
    update(p) {
      off();
      off = hoverImpl(node, p);
    },
    destroy: () => off(),
  };
}

export function drag(node: HTMLElement, opts: DragOptions = {}): ActionReturn<DragOptions> {
  let c = dragImpl(node, opts);
  return {
    update(p) {
      c.destroy();
      c = dragImpl(node, p);
    },
    destroy: () => c.destroy(),
  };
}

export function enter(node: HTMLElement, role: SemanticRole = "page"): ActionReturn<SemanticRole> {
  enterImpl(node, role);
  return {};
}

/** FLIP re-ordered children whenever the parameter (e.g. the list array) changes. */
export function layout(node: HTMLElement, _items?: unknown): ActionReturn<unknown> {
  const t = new LayoutTracker(node);
  return {
    update() {
      // Svelte calls update after the DOM changed.
      t.measure();
    },
  };
}

export function tilt(node: HTMLElement, opts: { max?: number } = {}): ActionReturn<{ max?: number }> {
  const off = tiltImpl(node, opts);
  return { destroy: off };
}
