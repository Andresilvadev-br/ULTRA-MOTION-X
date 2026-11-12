/**
 * Ultra Motion X CLI.
 *
 * Exit codes: 0 success · 1 failure · 2 usage error · 3 completed with conflicts or
 * issues that need human attention. Every command accepts `--json` for machine-readable
 * output and runs non-interactively (destructive commands require `--yes`).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyzeProject,
  applyPlan,
  applyUpdate,
  CONFIG_FILE,
  checkCompatibility,
  checkUpdate,
  createPlan,
  defaultConfig,
  doctor,
  findSource,
  heal,
  IntegrationError,
  markdownReport,
  previewPlan,
  readManifest,
  remoteVersions,
  rollback,
  runProjectTests,
} from "@ultra-motion-x/integration";
import { MotionDNA, PROFILE_NAMES } from "@ultra-motion-x/web";
import { loadCore } from "@ultra-motion-x/web/wasm";

export const VERSION = "1.0.0";

interface Args {
  _: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): Args {
  const out: Args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2) as [string, string | undefined];
      if (v !== undefined) out.flags[k] = v;
      else if (argv[i + 1] !== undefined && !argv[i + 1]!.startsWith("-") && VALUE_FLAGS.has(k))
        out.flags[k] = argv[++i]!;
      else out.flags[k] = true;
    } else if (a.startsWith("-") && a.length === 2) {
      const k = { y: "yes", j: "json", h: "help", o: "output" }[a[1]!] ?? a[1]!;
      if (k === "output") out.flags[k] = argv[++i] ?? "";
      else out.flags[k] = true;
    } else out._.push(a);
  }
  return out;
}

const VALUE_FLAGS = new Set([
  "profile",
  "mode",
  "entry",
  "adapter",
  "source",
  "files",
  "output",
  "remote",
  "roles",
  "format",
  "script",
]);

const HELP = `Ultra Motion X CLI ${VERSION}

Usage: umx <command> [dir] [options]

Project integration
  analyze [dir]            Detect platform, frameworks, components, existing animation
  check [dir]              Compatibility verification
  plan [dir]               Show the exact changes an install would make (diff, no writes)
  install [dir]            Analyze → check → plan → apply → validate → report
      --yes                 apply without confirmation (required when not a TTY)
      --profile <name>      motion profile (${PROFILE_NAMES.join(", ")})
      --mode vendor|npm     vendor the SDK (default, offline) or depend on the npm package
      --adapter <name>      override the detected adapter
      --entry <file>        override the detected entry point
      --annotate            add data-umx role attributes to clearly identified elements
      --dry-run             same as plan
      --force               allow replacing files that were already installed
  doctor [dir] [--fix]     Diagnose drift; --fix applies safe, reversible repairs
  rollback [dir]           Undo the last transaction (--all, --files a,b, --dry-run, --force)
  update [dir]             Check/apply engine updates (--check, --source <path>,
                            --remote <git-url>, --allow-major, --no-tests, --yes)
  report [dir]             Write .ultra-motion/report.md
  test [dir]               Run the project's tests and the integration doctor

Motion Design Language
  init [dir]               Create ultra-motion.config.json (--profile)
  validate <file>          Validate an MDL document
  compile <file>           Compile MDL to an execution plan (-o plan.json, --summary, --dot)
  migrate <file>           Migrate an MDL document to the current version (--write)
  presets [name]           List motion profiles or show one profile's tokens

Engine
  bench [--native|--web]   Run benchmarks from the Ultra Motion X repository
  version                  Print versions

Global: --json (machine output), --help`;

type Out = { json: boolean; log: (s: string) => void; data: (d: unknown) => void };

function output(flags: Args["flags"]): Out {
  const json = !!flags.json;
  return {
    json,
    log: (s) => {
      if (!json) console.log(s);
    },
    data: (d) => {
      if (json) console.log(JSON.stringify(d, null, 2));
    },
  };
}

const sev = (s: string) => (s === "error" ? "✖" : s === "warning" ? "▲" : "•");

export async function run(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const [cmd, target] = args._;
  const f = args.flags;
  const out = output(f);
  if (!cmd || f.help || cmd === "help") {
    console.log(HELP);
    return cmd || f.help ? 0 : 2;
  }
  const dir = resolve(target ?? ".");
  try {
    switch (cmd) {
      case "version": {
        const core = await loadCore().catch(() => null);
        const v = { cli: VERSION, core: core?.version ?? "unavailable", node: process.versions.node };
        out.data(v);
        out.log(`umx ${v.cli} (core ${v.core}, node ${v.node})`);
        return 0;
      }
      case "analyze": {
        const r = analyzeProject(dir);
        out.data(r);
        out.log(markdownReport({ report: r }));
        return 0;
      }
      case "check": {
        const r = analyzeProject(dir);
        const c = checkCompatibility(r);
        out.data(c);
        out.log(`Compatible: ${c.compatible ? "yes" : "no"}`);
        for (const i of c.issues)
          out.log(`${sev(i.severity)} ${i.code}: ${i.message}${i.fix ? `\n    → ${i.fix}` : ""}`);
        return c.compatible ? 0 : 1;
      }
      case "plan":
      case "install": {
        const r = analyzeProject(dir);
        const c = checkCompatibility(r);
        if (!c.compatible && !f.force) {
          out.data({ ok: false, compatibility: c });
          for (const i of c.issues.filter((x) => x.severity === "error"))
            out.log(`${sev(i.severity)} ${i.code}: ${i.message}`);
          return 1;
        }
        const source = findSource(f.source as string | undefined);
        const plan = createPlan(r, source, {
          mode: (f.mode as "vendor" | "npm") ?? "vendor",
          profile: f.profile as string | undefined,
          adapter: f.adapter as string | undefined,
          entry: f.entry as string | undefined,
          annotate: !!f.annotate,
          roles: typeof f.roles === "string" ? f.roles.split(",") : undefined,
        });
        const dry = cmd === "plan" || !!f["dry-run"];
        if (dry) {
          out.data({
            dryRun: true,
            changes: plan.changes.map((x) => ({ kind: x.kind, path: x.path, description: x.description })),
            notes: plan.notes,
            manualSteps: plan.manualSteps,
          });
          out.log(previewPlan(plan));
          out.log(markdownReport({ report: r, compatibility: c, plan }));
          return 0;
        }
        if (!f.yes) {
          if (!process.stdin.isTTY) {
            console.error(
              "Refusing to modify files without --yes in non-interactive mode. Review with `umx plan` first.",
            );
            return 2;
          }
          process.stdout.write(`${previewPlan(plan)}\nApply ${plan.changes.length} change(s)? [y/N] `);
          const answer = await new Promise<string>((res) => process.stdin.once("data", (d) => res(String(d).trim())));
          if (!/^y(es)?$/i.test(answer)) return 1;
        }
        const tx = applyPlan(plan, { force: !!f.force });
        const findings = doctor(dir);
        const md = markdownReport({ report: r, compatibility: c, plan, transaction: tx, findings });
        writeFileSync(join(dir, ".ultra-motion/report.md"), md);
        out.data({ ok: true, transaction: tx.id, changes: tx.changes.length, findings, manualSteps: plan.manualSteps });
        out.log(md);
        return findings.some((x) => x.severity === "error") ? 3 : 0;
      }
      case "doctor": {
        if (f.fix) {
          const { transaction, remaining } = heal(dir, f.source as string | undefined);
          out.data({ transaction: transaction?.id ?? null, remaining });
          out.log(
            transaction
              ? `Applied ${transaction.changes.length} fix(es) in ${transaction.id} (reversible with umx rollback).`
              : "Nothing to fix automatically.",
          );
          for (const x of remaining) out.log(`${sev(x.severity)} ${x.message}`);
          return remaining.some((x) => x.severity === "error") ? 3 : 0;
        }
        const findings = doctor(dir);
        out.data(findings);
        for (const x of findings)
          out.log(`${sev(x.severity)} ${x.message}${x.fixable ? "  (fixable: umx doctor --fix)" : ""}`);
        return findings.some((x) => x.severity === "error") ? 3 : 0;
      }
      case "rollback": {
        if (!f.yes && !f["dry-run"] && !process.stdin.isTTY) {
          console.error("Pass --yes to roll back non-interactively (or --dry-run to preview).");
          return 2;
        }
        const rep = rollback(dir, {
          all: !!f.all,
          files: typeof f.files === "string" ? f.files.split(",") : undefined,
          force: !!f.force,
          dryRun: !!f["dry-run"],
        });
        out.data(rep);
        out.log(
          `restored ${rep.restored.length}, reverted ${rep.reverted.length}, removed ${rep.removed.length}, conflicts ${rep.conflicts.length}${f["dry-run"] ? " (dry run)" : ""}`,
        );
        for (const c of rep.conflicts) out.log(`▲ ${c.path}: ${c.reason}${c.rejectFile ? ` (${c.rejectFile})` : ""}`);
        return rep.conflicts.length ? 3 : 0;
      }
      case "update": {
        if (typeof f.remote === "string") {
          const versions = remoteVersions(f.remote);
          const installed = readManifest(dir)?.installedVersion ?? null;
          out.data({ installed, versions });
          out.log(`installed ${installed ?? "none"}; released: ${versions.join(", ") || "none"}`);
          return 0;
        }
        const c = checkUpdate(dir, f.source as string | undefined);
        if (f.check || !f.yes) {
          out.data(c);
          out.log(`installed ${c.installed} → available ${c.available} (${c.change}${c.breaking ? ", BREAKING" : ""})`);
          for (const m of c.migrations) out.log(`  ${m.version}${m.breaking ? " [breaking]" : ""}: ${m.summary}`);
          if (!f.check && c.change !== "none")
            out.log("Re-run with --yes to apply (tests run automatically; failures roll back).");
          return 0;
        }
        const res = applyUpdate(dir, {
          source: f.source as string | undefined,
          allowMajor: !!f["allow-major"],
          runTests: !f["no-tests"],
        });
        out.data(res);
        out.log(
          res.transaction
            ? res.rolledBack
              ? `✖ Tests failed after update; rolled back.\n${res.tests.output}`
              : `Updated to ${res.check.available} (${res.transaction.id}).`
            : "Already up to date.",
        );
        return res.rolledBack ? 1 : 0;
      }
      case "report": {
        const r = analyzeProject(dir);
        const md = markdownReport({
          report: r,
          compatibility: checkCompatibility(r),
          findings: readManifest(dir) ? doctor(dir) : undefined,
        });
        const path = (f.output as string) || join(dir, ".ultra-motion/report.md");
        writeFileSync(path, md);
        out.data({ path });
        out.log(`Report written to ${path}`);
        return 0;
      }
      case "test": {
        const t = runProjectTests(dir, (f.script as string) ?? "test");
        const findings = readManifest(dir) ? doctor(dir) : [];
        out.data({ tests: t, findings });
        out.log(t.ran ? `tests ${t.passed ? "passed" : "FAILED"}` : "no test script");
        for (const x of findings) out.log(`${sev(x.severity)} ${x.message}`);
        return t.passed && !findings.some((x) => x.severity === "error") ? 0 : 1;
      }
      case "init": {
        const path = join(dir, CONFIG_FILE);
        try {
          readFileSync(path);
          console.error(`${CONFIG_FILE} already exists.`);
          return 1;
        } catch {
          /* create */
        }
        const profile = (f.profile as string) ?? "professional";
        MotionDNA.profile(profile);
        writeFileSync(path, `${JSON.stringify(defaultConfig(profile), null, 2)}\n`);
        out.data({ path });
        out.log(`Created ${path}`);
        return 0;
      }
      case "validate":
      case "compile":
      case "migrate": {
        if (!target) {
          console.error(`usage: umx ${cmd} <file.umx.json>`);
          return 2;
        }
        const src = readFileSync(dir, "utf8");
        const core = await loadCore();
        if (cmd === "migrate") {
          const m = core.migrate(src);
          if (m.ok && f.write) writeFileSync(dir, `${JSON.stringify(m.document, null, 2)}\n`);
          out.data(m);
          out.log(
            m.ok
              ? m.from
                ? `migrated from ${m.from}${f.write ? " (written)" : ""}`
                : "already current"
              : "migration failed",
          );
          if (!f.write && m.ok && !out.json) console.log(JSON.stringify(m.document, null, 2));
          return m.ok ? 0 : 1;
        }
        const res = core.compile(src);
        for (const d of res.diagnostics) out.log(`${sev(d.severity)} [${d.code}] ${d.path}: ${d.message}`);
        if (cmd === "validate") {
          out.data({ ok: res.ok, diagnostics: res.diagnostics });
          out.log(res.ok ? "valid" : "invalid");
          return res.ok ? 0 : 1;
        }
        if (!res.ok) {
          out.data(res);
          return 1;
        }
        if (f.summary || f.dot) {
          const text = core.inspect(src, f.dot ? "dot" : "summary");
          if (f.output) writeFileSync(f.output as string, text);
          else console.log(text);
          return 0;
        }
        const json = JSON.stringify(res.plan, null, 2);
        if (f.output) {
          writeFileSync(f.output as string, `${json}\n`);
          out.log(`plan written to ${f.output}`);
        } else console.log(json);
        return 0;
      }
      case "presets": {
        if (target) {
          const dna = MotionDNA.profile(target);
          out.data(dna.toJSON());
          out.log(`${dna.data.label} — ${dna.data.description}\n${JSON.stringify(dna.data, null, 2)}`);
          return 0;
        }
        const list = PROFILE_NAMES.map((n) => ({ name: n, ...MotionDNA.profile(n).data }));
        out.data(list.map((p) => ({ name: p.name, label: p.label, description: p.description })));
        for (const p of list) out.log(`${p.name.padEnd(16)} ${p.description}`);
        return 0;
      }
      case "bench": {
        const source = findSource(f.source as string | undefined);
        const runWeb = !!f.web;
        const r = runWeb
          ? spawnSync(process.execPath, [join(source.root, "benchmarks/web/browser.mjs")], {
              stdio: "inherit",
              cwd: source.root,
            })
          : spawnSync(
              "cargo",
              [
                "run",
                "--release",
                "-q",
                "-p",
                "umx-bench",
                "--bin",
                "umx-bench",
                "--",
                ...(f.quick ? ["--quick"] : []),
              ],
              {
                stdio: "inherit",
                cwd: source.root,
              },
            );
        return r.status ?? 1;
      }
      default:
        console.error(`unknown command \`${cmd}\`\n\n${HELP}`);
        return 2;
    }
  } catch (err) {
    if (err instanceof IntegrationError) {
      out.data({ ok: false, code: err.code, message: err.message, details: err.details });
      console.error(`✖ ${err.code}: ${err.message}`);
      for (const d of err.details) console.error(`  - ${d}`);
      return err.code === "CONFLICT" || err.code === "BREAKING" ? 3 : 1;
    }
    console.error(`✖ ${(err as Error).message}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
