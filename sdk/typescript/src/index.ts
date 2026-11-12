/**
 * @ultra-motion-x/web — public API.
 * Framework-agnostic; no dependency on React or any UI framework.
 */
export const VERSION = "1.0.0";

// Adaptive, accessibility, telemetry
export { Accessibility, type ReducedMotionSetting } from "./a11y/accessibility.ts";
export { diagnose, MotionAutotuner, type Recommendation, score, type TuningConfig } from "./adaptive/autotune.ts";
export {
  adaptProfile,
  CancellationModule,
  type IntelligenceModule,
  MotionIntelligence,
  TempoModule,
} from "./adaptive/intelligence.ts";
export { PowerMonitor, type PowerPolicy, powerPolicy } from "./adaptive/power.ts";
// Runtime
export { createDefaultDriver, type FrameDriver, ManualDriver } from "./core/driver.ts";
export {
  configureEngine,
  createEngine,
  Engine,
  type EngineEvent,
  type EngineOptions,
  getEngine,
  type Tickable,
} from "./core/engine.ts";
export {
  DEFAULT_FIDELITY,
  type FidelityChange,
  type FidelityConfig,
  FidelityController,
  type FidelityLevel,
  type FidelitySettings,
  fidelitySettings,
} from "./core/fidelity.ts";
export { type AnimationSpec, Generator, preservesVelocity, type Sample } from "./core/generator.ts";
export {
  type AnimationOutcome,
  type AnimationState,
  arbitrationStats,
  type InterruptPolicy,
  MotionValue,
  type MotionValueOptions,
  motionValue,
  type Priority,
  type ValueAnimateOptions,
  ValueAnimation,
} from "./core/motion-value.ts";
export { RefreshEstimator, snapRate } from "./core/refresh.ts";
export { FrameScheduler, type Phase, type TaskPriority } from "./core/scheduler.ts";
export { resolveSpec, resolveSpring, type TransitionOptions } from "./core/spec.ts";
export { type Distribution, distribution, type Metric, percentile } from "./core/stats.ts";
// DOM
export {
  type AnimateOptions,
  type AnimationControls,
  animate,
  motionValueOf,
  set,
  stagger,
  stop,
} from "./dom/animate.ts";
export { ElementTarget } from "./dom/element-target.ts";
// Graph & orchestration
export {
  type CompiledPlan,
  type GraphDef,
  type GraphEvent,
  graphDefFromPlan,
  graphFromPlan,
  MotionGraph,
  type TransitionDef,
  validateGraph,
} from "./graph/motion-graph.ts";
// Interaction
export { type DragController, type DragOptions, drag } from "./interaction/drag.ts";
export {
  type HoverOptions,
  hover,
  type MagneticOptions,
  magnetic,
  type PressOptions,
  press,
} from "./interaction/feedback.ts";
export { type GestureOptions, gestures } from "./interaction/gestures.ts";
export { gamepadNavigation, rovingFocus } from "./interaction/navigation.ts";
export { PointerTracker } from "./interaction/pointer.ts";
export { predictIntent, predictPosition, projectRelease } from "./interaction/predict.ts";
// Living interface
export { exitAndRemove, type LayoutOptions, LayoutTracker, layoutTransition } from "./living/layout.ts";
export { interpolatePath, morphContainer, morphPath, pathsCompatible } from "./living/morph.ts";
export { animateShared, captureShared, sharedTransition, viewTransition } from "./living/shared.ts";
export { depthStack, parallax, tilt } from "./living/spatial.ts";
export { formatColor, mixColor, parseColor, type Rgba } from "./math/color.ts";
export { Decay, type DecayParams, decayFromRate } from "./math/decay.ts";
// Math & physics
export {
  applyEasing,
  cubicBezier,
  type Easing,
  type EasingInput,
  easingToCss,
  namedEasing,
  resolveEasing,
} from "./math/easing.ts";
export {
  classifyIntent,
  type Intent,
  magneticOffset,
  magneticOffset2D,
  rubberBand,
  rubberBandClamp,
  selectSnapPoint,
  VelocityTracker,
} from "./math/gesture.ts";
export { Inertia, type InertiaParams } from "./math/inertia.ts";
export { Keyframes } from "./math/keyframes.ts";
export {
  dampingRatio,
  fromDurationBounce,
  fromResponse,
  MotionError,
  naturalFrequency,
  Spring,
  type SpringParams,
  springParams,
} from "./math/spring.ts";
export {
  choreograph,
  MotionGroup,
  parallel,
  race,
  sequence,
  Timeline,
  type TimelineSegment,
  timeline,
} from "./orchestration/timeline.ts";
// Particles & Time Machine
export {
  CpuParticles,
  type EmitterConfig,
  type ForceConfig,
  ParticleSystem,
  wasmParticleBackend,
} from "./particles/particles.ts";
export { expand, loadingPulse, openWindow, presets, scrollToY, tabIndicator } from "./presets/library.ts";
export { type AutoEnhanceController, type AutoEnhanceOptions, autoEnhance } from "./semantic/auto.ts";
export {
  attachInteraction,
  closeDialog,
  detectRole,
  enter,
  exit,
  openDialog,
  progressTo,
  type SemanticRole,
} from "./semantic/semantic.ts";
export { compareReports, Telemetry, type TelemetryReport } from "./telemetry/telemetry.ts";
export {
  compareRecordings,
  detectAnomalies,
  MotionPlayer,
  MotionRecorder,
  type Recording,
  replayScenario,
} from "./timemachine/time-machine.ts";
// Motion DNA, semantics, presets
export { MotionDNA, PROFILE_NAMES, type ProfileName } from "./tokens/dna.ts";
export type { MotionProfileData } from "./tokens/types.ts";
