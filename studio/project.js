// Studio project model: one JSON document shared by every lab, with undo/redo history,
// local persistence (localStorage, this browser only) and file import/export.
const STORAGE_KEY = "umx:studio:project:v1";
const HISTORY_LIMIT = 100;

export function defaultProject() {
  return {
    format: "umx-studio/1",
    curve: [0.2, 0, 0, 1],
    timeline: {
      duration: 1200,
      tracks: [
        {
          prop: "x",
          keys: [
            { t: 0, v: -120 },
            { t: 600, v: 120 },
            { t: 1200, v: 0 },
          ],
        },
        {
          prop: "scale",
          keys: [
            { t: 0, v: 1 },
            { t: 300, v: 1.15 },
            { t: 900, v: 1 },
          ],
        },
        {
          prop: "opacity",
          keys: [
            { t: 0, v: 0.4 },
            { t: 400, v: 1 },
          ],
        },
        {
          prop: "rotate",
          keys: [
            { t: 0, v: 0 },
            { t: 1200, v: 180 },
          ],
        },
      ],
    },
    compare: { a: { stiffness: 320, damping: 28, mass: 1 }, b: { stiffness: 180, damping: 12, mass: 1 } },
    mdl: null,
  };
}

export function validateProject(p) {
  const errors = [];
  if (!p || typeof p !== "object") return ["project must be an object"];
  if (p.format !== "umx-studio/1") errors.push("format must be umx-studio/1");
  if (!Array.isArray(p.curve) || p.curve.length !== 4 || !p.curve.every(Number.isFinite))
    errors.push("curve must be 4 numbers");
  else if (p.curve[0] < 0 || p.curve[0] > 1 || p.curve[2] < 0 || p.curve[2] > 1)
    errors.push("curve x1/x2 must be within [0, 1]");
  const tl = p.timeline;
  if (!tl || !Number.isFinite(tl.duration) || tl.duration <= 0 || !Array.isArray(tl.tracks))
    errors.push("timeline must have a positive duration and tracks");
  else
    for (const [i, track] of tl.tracks.entries()) {
      if (typeof track.prop !== "string" || !Array.isArray(track.keys)) errors.push(`timeline.tracks[${i}] is invalid`);
      else if (track.keys.some((k) => !Number.isFinite(k.t) || !Number.isFinite(k.v) || k.t < 0))
        errors.push(`timeline.tracks[${i}].keys are invalid`);
    }
  if (p.mdl !== null && typeof p.mdl !== "string") errors.push("mdl must be a JSON string or null");
  return errors;
}

export class Project {
  constructor() {
    this.state = this.load() ?? defaultProject();
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Set();
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      return validateProject(p).length ? null : p;
    } catch {
      return null;
    }
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      return true;
    } catch {
      return false;
    }
  }

  /** Applies a mutation as one undoable step. */
  update(label, mutate) {
    const before = JSON.stringify(this.state);
    const draft = JSON.parse(before);
    mutate(draft);
    const errors = validateProject(draft);
    if (errors.length) throw new Error(errors.join("; "));
    if (JSON.stringify(draft) === before) return;
    this.undoStack.push({ label, snapshot: before });
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.state = draft;
    this.save();
    this.emit(label);
  }

  undo() {
    const step = this.undoStack.pop();
    if (!step) return false;
    this.redoStack.push({ label: step.label, snapshot: JSON.stringify(this.state) });
    this.state = JSON.parse(step.snapshot);
    this.save();
    this.emit(`undo ${step.label}`);
    return true;
  }

  redo() {
    const step = this.redoStack.pop();
    if (!step) return false;
    this.undoStack.push({ label: step.label, snapshot: JSON.stringify(this.state) });
    this.state = JSON.parse(step.snapshot);
    this.save();
    this.emit(`redo ${step.label}`);
    return true;
  }

  get history() {
    return this.undoStack.map((s) => s.label);
  }

  replace(next, label = "import") {
    const errors = validateProject(next);
    if (errors.length) throw new Error(errors.join("; "));
    this.update(label, (d) => {
      for (const k of Object.keys(d)) delete d[k];
      Object.assign(d, JSON.parse(JSON.stringify(next)));
    });
  }

  reset() {
    this.replace(defaultProject(), "reset project");
  }

  export() {
    return JSON.stringify(this.state, null, 2);
  }

  on(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  emit(label) {
    for (const l of this.listeners) l(label, this.state);
  }
}

/** Triggers a download of `text` as a file (no server involved). */
export function download(name, text, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Opens a file picker and resolves with the file text. */
export function pickFile(accept = ".json,application/json") {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return reject(new Error("no file selected"));
      if (file.size > 4 * 1024 * 1024) return reject(new Error("file larger than 4 MB"));
      file.text().then(resolve, reject);
    };
    input.click();
  });
}
