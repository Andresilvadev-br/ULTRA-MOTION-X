// The preview imports the actual SDK built by npm run build; no substitute physics.
const $ = (id) => document.getElementById(id);
try {
  const { createEngine, animate, set, stop, press, Spring, springParams, naturalFrequency, dampingRatio, MotionDNA } =
    await import("/sdk/typescript/dist/index.js");
  const engine = createEngine({ profile: "professional", devtoolsHook: true });
  const fields = ["stiffness", "damping", "mass", "distance"];
  const defaults = { ...MotionDNA.profile("professional").spring(), distance: 240 };
  for (const key of fields) {
    $(key).step = "any";
    $(key).value = defaults[key];
  }
  let active;
  let direction = 1;
  let toastTimer;
  let cardOpen = false;
  let custom = false;
  const params = () => springParams(Object.fromEntries(fields.slice(0, 3).map((key) => [key, Number($(key).value)])));
  const distance = () => Math.min(Number($("distance").value), Math.max(0, $("preview").clientWidth - 140));
  const options = () => ({ engine, spring: params(), compositor: true });
  const cleanups = [press($("demo-button"), { engine })];
  function graph() {
    const p = params();
    const spring = new Spring(p, 0, distance());
    const duration = Math.min(12, Math.max(0.3, spring.finishTime));
    const canvas = $("curve");
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    const samples = Array.from({ length: 241 }, (_, i) => spring.sample((duration * i) / 240).value);
    const low = Math.min(0, ...samples);
    const high = Math.max(1, distance(), ...samples);
    const y = (value) => height - 12 - ((value - low) / (high - low)) * (height - 24);
    ctx.strokeStyle = "#343b4a";
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(0, y(distance()));
    ctx.lineTo(width, y(distance()));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "#ff8748";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    samples.forEach((value, i) => {
      if (i === 0) ctx.moveTo(0, y(value));
      else ctx.lineTo((width * i) / 240, y(value));
    });
    ctx.stroke();
    $("frequency").textContent = `${(naturalFrequency(p) / (2 * Math.PI)).toFixed(2)} Hz`;
    $("ratio").textContent = dampingRatio(p).toFixed(3);
    $("settle").textContent = `${Math.round(spring.finishTime * 1000)} ms`;
    $("duration-label").textContent = `${Math.round(duration * 1000)} ms`;
    $("profile-indicator").textContent = custom ? `${$("profile").value} · custom` : $("profile").value;
    for (const key of fields)
      $(key + "-out").textContent =
        Number($(key).value).toFixed(key === "distance" ? 0 : 2) + (key === "distance" ? " px" : "");
  }
  function play(reset = false) {
    if (reset) set($("orb"), { x: -distance() / 2 }, engine);
    const run = animate($("orb"), { x: (direction * distance()) / 2 }, options());
    active = run;
    direction *= -1;
    $("motion-status").textContent = "Running";
    run.finished.then(() => {
      if (active === run) $("motion-status").textContent = "Settled";
    });
  }
  for (const key of fields)
    $(key).addEventListener("input", () => {
      custom = true;
      graph();
      play();
    });
  $("profile").addEventListener("change", () => {
    engine.setProfile($("profile").value);
    const p = MotionDNA.profile($("profile").value).spring();
    for (const key of fields.slice(0, 3)) {
      // Preserve profile parameters exactly, including values outside the initial slider range.
      $(key).min = Math.min(Number($(key).min), p[key]);
      $(key).max = Math.max(Number($(key).max), p[key]);
      $(key).step = "any";
      $(key).value = p[key];
    }
    custom = false;
    graph();
    play();
  });
  $("replay").addEventListener("click", () => play());
  $("reset").addEventListener("click", () => {
    active?.cancel();
    active = undefined;
    direction = 1;
    custom = false;
    engine.setProfile("professional");
    $("profile").value = "professional";
    for (const key of fields) $(key).value = defaults[key];
    for (const id of ["demo-button", "demo-tile", "toast"]) stop($(id));
    clearTimeout(toastTimer);
    $("toast").classList.remove("visible");
    cardOpen = false;
    set($("demo-tile"), { y: 0, rotate: 0, scale: 1 }, engine);
    set($("orb"), { x: -distance() / 2 }, engine);
    $("motion-status").textContent = "Ready";
    graph();
  });
  $("demo-card").addEventListener("click", () => {
    cardOpen = !cardOpen;
    animate(
      $("demo-tile"),
      { y: cardOpen ? -16 : 0, rotate: cardOpen ? -6 : 0, scale: cardOpen ? 1.08 : 1 },
      options(),
    );
  });
  $("demo-toast").addEventListener("click", () => {
    clearTimeout(toastTimer);
    $("toast").classList.add("visible");
    animate($("toast"), { opacity: [0, 1], y: [12, 0] }, options());
    toastTimer = setTimeout(() => {
      animate($("toast"), { opacity: 0 }, { engine, duration: 180 }).finished.then((outcomes) => {
        if (outcomes.every((outcome) => outcome === "completed")) $("toast").classList.remove("visible");
      });
    }, 2800);
  });
  const labs = {
    spring: ["Spring Physics", "Feel the dynamics of a real Ultra Motion X spring."],
    components: ["Component Motion", "Press, release and interrupt real SDK interactions."],
    profiles: ["Motion DNA", "Choose a shared motion identity and inspect its spring response."],
  };
  for (const button of document.querySelectorAll("[data-lab]"))
    button.addEventListener("click", () => {
      for (const item of document.querySelectorAll("[data-lab]")) {
        item.classList.toggle("active", item === button);
        item.setAttribute("aria-pressed", String(item === button));
      }
      const [title, desc] = labs[button.dataset.lab];
      $("page-title").textContent = title;
      $("page-desc").textContent = desc;
      document.querySelector(".graph").hidden = button.dataset.lab === "components";
      document.querySelector(".components").hidden = button.dataset.lab === "profiles";
      graph();
    });
  $("export").addEventListener("click", async () => {
    const json = JSON.stringify(
      { profile: $("profile").value, spring: params(), distance: Number($("distance").value) },
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(json);
      $("export").textContent = "Parameters copied";
    } catch {
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "ultra-motion-parameters.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      $("export").textContent = "Parameters downloaded";
    }
  });
  const observer = new ResizeObserver(() => graph());
  observer.observe($("preview"));
  cleanups.push(() => observer.disconnect());
  window.addEventListener(
    "pagehide",
    () => {
      clearTimeout(toastTimer);
      active?.cancel();
      cleanups.forEach((cleanup) => cleanup());
      engine.destroy();
    },
    { once: true },
  );
  const updateMode = () => {
    $("mode").textContent = engine.reducedMotion ? "Reduced motion" : "Web SDK / WAAPI";
  };
  cleanups.push(engine.on("reducedmotion", updateMode));
  updateMode();
  $("engine-state").textContent = "Engine connected";
  graph();
  play(true);
} catch (error) {
  $("engine-state").textContent = "Engine unavailable";
  $("fatal").hidden = false;
  $("fatal").textContent = `Studio could not load: ${error.message}. Run npm ci and npm run build, then reload.`;
}
