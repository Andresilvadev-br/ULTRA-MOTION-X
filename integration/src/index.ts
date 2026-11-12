export { analyzeProject, type DiscoveredComponent, type Platform, type ProjectReport } from "./analyzer.ts";
export { type CompatibilityResult, checkCompatibility, type Issue } from "./compatibility.ts";
export { diffLines, type Hunk, hunks, revertHunks, unifiedDiff } from "./diff.ts";
export { doctor, type Finding, heal, validateConfig } from "./doctor.ts";
export {
  applyPlan,
  IntegrationError,
  MANIFEST,
  type Manifest,
  previewPlan,
  type RollbackReport,
  readManifest,
  revertTransaction,
  rollback,
  type Transaction,
  verifyPlan,
} from "./installer.ts";
export {
  annotateSource,
  bootstrapSource,
  CONFIG_FILE,
  createPlan,
  DEFAULT_ROLES,
  defaultConfig,
  type IntegrationConfig,
  type IntegrationPlan,
  type PlanOptions,
  VENDOR_DIR,
} from "./plan.ts";
export { markdownReport } from "./report.ts";
export { findSource, type UmxSource } from "./source.ts";
export {
  applyUpdate,
  checkUpdate,
  loadMigrations,
  remoteVersions,
  runProjectTests,
  type UpdateCheck,
} from "./update.ts";
export { compareSemver, parseSemver, semverChange } from "./util.ts";
