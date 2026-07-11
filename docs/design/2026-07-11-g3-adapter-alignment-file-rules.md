# memex-openclaw addendum — G3 adapter alignment (file-shaped rules via shared-origin)

**Date:** 2026-07-11  
**Status:** design **GATED** (memex merged #16) — **impl in progress** on `feat/g3-projection-core-0.6`  
**Design PR:** https://github.com/jim80net/memex-openclaw/pull/16 (merged)  
**Authority:** product steer `flotilla-dispatch-c29001c1` · CoS AUTHORIZE wave 2026-07-11 · G3 brief `adapter-alignment-g3-2026-07-11.md`  
**Pin (impl, post-gate):** `@jim80net/memex-core@^0.6.0` (npm freeze LIVE; this package is still on `^0.3.1` at design time — **largest seat jump in the pin matrix**)  
**Proven path:** memex-grok#30 design + #31 impl (`src/core/projection.ts`)  
**Parent flotilla briefs:**  
- `memex-flotilla/briefs/file-rules-shared-origin-2026-07-10.md`  
- `memex-flotilla/briefs/adapter-alignment-g3-2026-07-11.md` (CoS scope + pin matrix)  
**Core peer:** memex-core `design/shared-origin-sync-profile.md` + shipped `src/origin.ts`  
**Scope:** memex-openclaw only. Author ≠ merger; surface PR to **memex** for gate.

### CoS-locked wave scope (acceptance)

| Track | Requirement | OpenClaw plan |
|-------|-------------|----------------|
| **A. Core pin** | `@jim80net/memex-core@^0.6.0`; tests green; no silent skew | Impl PR bumps pin; full `pnpm check`; call out 0.3.1→0.6.0 surface (§1.6) |
| **B. File-shaped projection** | Rules (skills where supported) via core plan/apply into **real harness dirs**; prefer files over inject; no invented inject paths | Project origin `rules/*.md` → `~/.openclaw/rules`; wire `ruleDirs`; keep existing inject as delivery for *indexed* files — not a new inject path |
| **C. `~/.memex` migrate** | **Opt-in only** if it unblocks A/B; default keep current origins (legacy-claude OK via resolver) | **No migrate in v1.** `resolveOriginRoot()` only; never call `migrateOriginToDefault` unless a later opt-in flag is design-gated |

**Non-goals (wave):** codex-memex-dev cutover · freelancing · live-injection renaissance · freeze-SHA from this seat · self-merge.

---

## 0. Bottom line

OpenClaw alignment reuses the **same core projection contract** Grok proved: `resolveOriginRoot` → `planProjection` / `applyProjection` (absolute symlinks v1, fail-closed no-clobber, partial apply + conflict report). This adapter is a **thin harness projection layer** — it must **not** reimplement FS policy or fork origin layout.

Unlike Grok, memex-openclaw is an **OpenClaw plugin** (hooks + service), not a standalone CLI. Projection therefore lands as a thin module + **service-start / optional script** entrypoints, not `memex init` CLI parity.

Unlike Grok, this tree **has no pre-existing rules directory scan**. Skills are the only hard-coded corpus roots. v1 therefore (a) projects origin `rules/*.md` into **memex-managed rule dirs under the verified OpenClaw home/workspace**, and (b) wires those dirs into core `ScanDirs.ruleDirs` so the existing index path can see them — without double-scanning origin.

**Prefer files over inject (CoS B):** rules become real files (symlinks) under the harness before index/inject. Existing `before_prompt_build` / `before_tool_call` remain the **delivery** of already-indexed corpus — not a new inject surface and not inject-as-primary for corpus placement. Do **not** invent MCP-only memory for OpenClaw. Health messaging: *memory/rules/skills = file-shaped corpus + graduated inject of matches* (honest for this harness).

---

## 1. Verified tree facts (do not invent)

Read on `main` at design time (`33d3d81` family). All path claims below cite this package’s code.

### 1.1 OpenClaw-specific path constants — `src/index.ts`

| Constant / builder | Resolved path | Role today |
|--------------------|---------------|------------|
| `OPENCLAW_DIR` | `~/.openclaw` | Harness home for plugin state |
| `CACHE_DIR` | `~/.openclaw/cache` | Cache root |
| `CACHE_PATH` | `~/.openclaw/cache/skill-router.json` | Embedding cache |
| `TELEMETRY_PATH` | `~/.openclaw/cache/skill-router-telemetry.json` | Match telemetry |
| `TRACES_DIR` | `~/.openclaw/cache/skill-router-traces` | Execution traces |
| `MODELS_DIR` | `~/.openclaw/cache/models` | ONNX model cache |
| `MANAGED_SKILLS_DIR` | `~/.openclaw/workspace/skills` | Global skills scan root |
| `buildScanDirs` skillDirs | `[join(workspaceDir, "skills"), MANAGED_SKILLS_DIR, ...config.skillDirs]` | Skill index roots |
| `buildScanDirs` memoryDirs | `[...config.memoryDirs]` only | No default memory path |
| `buildScanDirs` ruleDirs | **`[]` always** | Rules dirs **not scanned** |

Code:

```33:38:src/index.ts
function buildScanDirs(workspaceDir: string, config: SkillRouterConfig): ScanDirs {
  return {
    skillDirs: [join(workspaceDir, "skills"), MANAGED_SKILLS_DIR, ...config.skillDirs],
    memoryDirs: [...config.memoryDirs],
    ruleDirs: [],
  };
}
```

### 1.2 Config surface — `src/config.ts` + `openclaw.plugin.json`

- Config type is `SkillRouterConfig = MemexCoreConfig` (core fields only).
- `resolveConfig()` maps plugin config: `enabled`, scoring/embedding knobs, `skillDirs`, `memoryDirs`, `types`.
- **No `sync` / origin / projection fields** exist today.
- Defaults: `enabled: false`; `types` includes `"rule"`; skill/memory dir arrays empty in defaults (workspace + managed skills injected only in `buildScanDirs`).
- Delivery is **plugin-config under OpenClaw** (`plugins.entries.memex-openclaw.config`), not `~/.grok/memex.json`.

### 1.3 How “rules” work today (disclosure ≠ scan path)

- Router treats `type === "rule"` (and stop-rule family) with full-then-reminder disclosure (`src/router.ts`).
- Indexing still depends on files being discovered via `skillDirs` / `memoryDirs` / `ruleDirs`.
- Core `scanRuleDirs` indexes flat `*.md` under each `ruleDirs` entry (`memex-core` `skill-index.ts`).
- Core `scanSkillDirs` indexes `*/SKILL.md` under each `skillDirs` entry.
- Documented skill locations (README / CLAUDE.md):  
  - `<workspace>/skills/<name>/SKILL.md`  
  - `~/.openclaw/workspace/skills/<name>/SKILL.md`  
  - plus `config.skillDirs`
- Documented multi-agent memory pattern (README only; not hard-coded defaults):  
  - `~/.openclaw/workspace*/memory/`, `~/.openclaw/shared/` via **explicit** `memoryDirs`.

### 1.4 Host dogfood snapshot (context, not product contract)

On the design host, `~/.openclaw` exists with agent workspaces (e.g. `workspace-spark-sre/` containing `memory/`, identity markdown). That confirms **OpenClaw home = `~/.openclaw`** and workspace-under-home layout, but does **not** establish a native `rules/` product directory. Design must not claim OpenClaw itself ships `~/.openclaw/rules`.

### 1.5 Dependency gap

| Item | Today | G3 target (impl, post-gate) |
|------|-------|-----------------------------|
| `@jim80net/memex-core` | `^0.3.1` | `^0.6.0` |
| Origin / projection API | not consumed | `resolveOriginRoot`, `planProjection`, `applyProjection` |
| CLI / doctor | none | optional script + service health logs (see §7) |

### 1.6 Pin jump `^0.3.1` → `^0.6.0` (largest in wave) — breakages & skew

Wave pin matrix calls this seat out explicitly. Audit of **this package’s actual imports/call sites** against current memex-core main (0.6 surface):

#### What we consume today

| Import / call | Site | 0.6 status |
|---------------|------|------------|
| `MemexCoreConfig`, `SkillType`, `DEFAULT_CORE_CONFIG` | `src/config.ts` | **Stable** — same fields openclaw spreads/overrides; core still has `enabled`, scoring, dirs |
| `SkillIndex(config, provider, CACHE_PATH)` | `src/index.ts` | **Compatible** — optional 4th `SkillIndexOptions` (portable-location registry); omit → absolute paths as today |
| `LocalEmbeddingProvider(model, MODELS_DIR)` / `OpenAIEmbeddingProvider` | `src/index.ts` | **Stable** |
| `InMemorySessionTracker`, `TraceAccumulator` | `src/index.ts` | **Stable** |
| `ScanDirs` `{ skillDirs, memoryDirs, ruleDirs }` | `src/index.ts` | **Stable** shape; we finally **use** `ruleDirs` post-projection |
| `loadTelemetry` / `recordMatch` / `saveTelemetry` | `src/router.ts` | **Stable** (0.3 GEPA family still present; 0.5+ additive) |
| Types: `IndexedSkill`, `Logger`, `SessionTracker`, `SkillSearchResult` | router + tests | **Stable** for mocked test surface |

#### Additive core releases (no intentional openclaw consumer yet)

| Core | What shipped | OpenClaw impact if pin-only |
|------|--------------|-----------------------------|
| **0.4.0** | sync case-insensitive project IDs + migration | **None** — openclaw does not call sync/project mapping today |
| **0.5.0** | portable location handles at index time (`SkillIndexOptions.registry`) | **None if we omit registry** — keep absolute cache keys; do **not** silently enable registry without a design decision (would skew cache identity) |
| **0.6.0** | origin + `planProjection` / `applyProjection` / migrate helpers | **New code only** — projection module; migrate APIs **not** called by default (CoS C) |

#### Explicit non-breakage commitments for impl

1. **No silent portable-location enablement** on pin bump — `new SkillIndex(config, provider, CACHE_PATH)` stays 3-arg unless a follow-on design enables registry.  
2. **No silent `~/.memex` migrate** — do not call `migrateOriginToDefault` / `installLegacyOriginCompatSymlink` in v1 paths.  
3. **Cache file** `~/.openclaw/cache/skill-router.json` may re-embed on first build after pin if core cache schema differs — acceptable; not a behavioral fork. If CI shows schema hard-fail, document and wipe-or-migrate cache path in impl PR only.  
4. **Tests** mock `SkillIndex` heavily — pin bump risk is mainly **typecheck** + any runtime export rename (none expected for listed imports).  
5. **Largest-jump residual risk:** transitive optional `@huggingface/transformers` / Node types — fixed by green `pnpm check` on impl PR, not by design speculation.

#### Impl sequencing preference

Prefer **one impl PR** after design gate: pin `^0.6.0` + projection + scan/health + tests. Split only if pin-alone fails typecheck/tests and needs a hotfix first (then file intentional lag issue per CoS A — not expected).

---

## 2. Goals and non-goals

### Goals (this adapter slice)

| ID | Goal |
|----|------|
| **A1** | Pin core `^0.6.0` and call **only** core projection primitives for symlink policy. |
| **A2** | When **projection profile is set**: ensure target rule dirs, symlink origin `rules/*.md` → harness targets (`readlink` shows origin). |
| **A3** | Fail-closed no-clobber: real files/dirs never overwritten; conflicts reported; partial apply OK. |
| **A4** | Scan policy: **one content blob → one index entry** (no origin + harness double-scan). |
| **A5** | Health messaging: origin present; projected rules are links into origin; conflicts WARN; memory surface wording matches **this** harness (inject index), not Grok MCP copy. |
| **A6** | Entrypoint idiomatic to OpenClaw: projection on plugin service start when profile set + optional offline script for dry-run/strict verify. |

### Non-goals

- inject-first product redesign · hermes #21 as primary  
- skill/rule **refinement** feedback product  
- memex-hermes #20 constitution dump into shareable origin  
- codex-memex-dev seat cutover  
- forking origin layout / reimplementing core FS policy  
- Mass-migrating production origin to `~/.memex` (resolver already handles legacy)  
- Projecting **memory** corpus into harness memory dirs in v1 (memory stays operator-configured `memoryDirs`; optional follow-on)  
- Skills projection in v1 (same pattern, follow-on after rules path proven — mirrors Grok backlog)

---

## 3. Core contract (consume, do not fork)

From `@jim80net/memex-core@0.6.0` (`src/origin.ts`, `types.ProjectionTarget` / `SyncProfile`):

| API | Adapter use |
|-----|-------------|
| `resolveOriginRoot({ root?, homeDir?, env? })` | Resolve live origin (`MEMEX_ORIGIN`, `~/.memex`, XDG, legacy-claude, …) |
| `planProjection(originRoot, targets, { relinkManaged })` | Build create/noop/relink/conflict plan |
| `applyProjection(plan, { onClobber: "fail-closed" })` | Absolute symlinks; partial success |
| `ProjectionTarget` | Harness-absolute `targetDir` + origin-relative `originRelDir` + `entryKind` |
| `initSyncRepo` / `syncPull` (optional) | Only if profile carries git remote (same bridge as Grok) |

**v1 symlink policy is core-owned:** absolute links, fail-closed, relink managed links that still point under origin.

Adapter owns only:

1. Path constants for OpenClaw targets  
2. Profile “set” predicate  
3. Building `ProjectionTarget[]`  
4. Wiring `buildScanDirs` after projection  
5. Plugin/script UX + health logs  

---

## 4. Harness projection mapping

### 4.1 Rules — v1 primary surface

Core origin layout (product): `originRoot/rules/*.md`.

| Target id | `targetDir` (absolute) | `originRelDir` | `entryKind` | `pattern` | Notes |
|-----------|------------------------|----------------|-------------|-----------|-------|
| `openclaw-global-rules` | `join(OPENCLAW_DIR, "rules")` → `~/.openclaw/rules` | `"rules"` | `"files"` | `"*.md"` | **Memex-managed** dir under verified `OPENCLAW_DIR`. Not a pre-existing OpenClaw product path; justified by (1) constant `OPENCLAW_DIR`, (2) core `ruleDirs` scan of flat `*.md`. |
| `openclaw-workspace-rules` | `join(workspaceDir, "rules")` | **only if** distinct origin subtree supplied | `"files"` | `"*.md"` | **Optional / v1 off by default.** Do **not** project the same origin `rules/` into both global and workspace (double-index). Grok deferred project rules the same way unless `projectOriginRelDir` is explicit. |

**v1 default targets:** global rules only:

```ts
// Illustrative — design, not impl
{
  id: "openclaw-global-rules",
  targetDir: join(homedir(), ".openclaw", "rules"), // OPENCLAW_DIR/rules
  originRelDir: "rules",
  entryKind: "files",
  pattern: "*.md",
  initTargetDir: true,
}
```

### 4.2 Why not pretend OpenClaw already has `rules/`?

Verified code sets `ruleDirs: []`. Skills live under `skills/`. Rules *type* is a frontmatter/disclosure concept. G3 still needs a **file-shaped** harness landing zone for origin rules so:

1. `readlink` provenance works (Grok dogfood bar).  
2. Core `scanRuleDirs` can index them without abusing `skillDirs` (skills expect `*/SKILL.md` folders).  

Placing that zone under `~/.openclaw/rules` keeps all plugin-managed state under the already-centralized OpenClaw home (cache already lives there). README will document it as **memex projection**, not as a native OpenClaw feature.

### 4.3 Skills — follow-on (designed, not v1)

| Target id | `targetDir` | `originRelDir` | `entryKind` |
|-----------|-------------|----------------|-------------|
| `openclaw-managed-skills` | `MANAGED_SKILLS_DIR` (`~/.openclaw/workspace/skills`) | `"skills"` | `"skill-dirs"` |

Workspace `join(workspaceDir, "skills")` may later take `projects/<id>/skills` — same double-index caution as rules.

### 4.4 Memory — not projected in v1

Keep `config.memoryDirs` operator-owned (README multi-agent / shared pattern). No symlink projection into `memory/` in this wave. Health messaging must not claim memory is MCP-only.

---

## 5. Profile “set” signal

OpenClaw has **no** `memex.json`. Config is plugin config.

### 5.1 Definition (v1)

A projection profile is **set** when:

```text
pluginConfig.sync.enabled === true
```

(defaults **false** — matches Grok’s safe default; no surprise FS writes).

Optional fields (names aligned with core / Grok bridge):

```jsonc
// plugins.entries.memex-openclaw.config (OpenClaw config)
{
  "enabled": true,                 // existing — router inject
  "sync": {
    "enabled": true,               // projection master switch (NEW)
    "repoDir": null,               // origin override → resolveOriginRoot({ root })
    "repo": "",                    // optional git remote
    "autoPull": false,             // default false for gateway safety
    "autoCommitPush": false
  },
  "memoryDirs": ["..."],           // existing — unchanged semantics
  "skillDirs": []
}
```

### 5.2 Priority for origin root

1. `config.sync.repoDir` if non-empty → `resolveOriginRoot({ root })`  
2. else `resolveOriginRoot()` (env `MEMEX_ORIGIN` → `~/.memex` → XDG → legacy-claude → default)  
3. **Do not** invent an OpenClaw-private origin under `~/.openclaw/…` for corpus storage.  
4. **CoS C — migrate opt-in only:** v1 never auto-migrates. Legacy-claude / XDG origins remain valid via resolver. A future `sync.migrateToDefaultOrigin: true` (name TBD) would be a separate design-gated flag with reversibility notes — **out of this wave default**.

### 5.3 Interaction with `enabled`

| `enabled` (router) | `sync.enabled` (projection) | Behavior |
|--------------------|-----------------------------|----------|
| false | false | Plugin no-ops (today) |
| false | true | May still project on service start / script (links for other tools); index/inject off |
| true | false | Today’s behavior: scan skills + memoryDirs only; no projection |
| true | true | Project then scan projected ruleDirs + skills + memoryDirs |

Recommendation: dogfood uses both `true`.

---

## 6. Entrypoints (idiomatic to this adapter)

There is **no** `main.ts` / `memex` CLI in this package (verified: `package.json` scripts are lint/typecheck/test only; entry is `openclaw.extensions: ./src/index.ts`).

### 6.1 Primary: plugin service start

Today `registerService({ id: "memex-openclaw-index", start })` builds the index when `api.config.workspace.dir` is set.

**Post-gate change (design):**

1. If `isProjectionProfileSet(config)` → `runOpenClawProjection(...)` (thin wrapper, Grok’s `runGrokProjection` shape).  
2. Then `index.build(buildScanDirs(...))` with projection-aware scan dirs.  
3. Log a single-line summary: `origin=… linked=… conflicts=…` (scrub if any host-path policy is adopted later; today openclaw logs paths freely — stay consistent with existing logger style unless a separate egress rule appears).

Idempotent re-run on gateway restart is required (core plan noop for correct links).

### 6.2 Secondary: offline script (verify / CI / dogfood)

Add (impl later) something like:

- `scripts/project-rules.mjs` or `pnpm project-rules -- --dry-run|--strict`  
- Loads the same projection helper; no OpenClaw gateway required.  
- Exit 1 under `--strict` if any conflicts or pending creates when operator expects a clean desk.

This is the dogfood bar equivalent of Grok’s `memex init --strict`.

### 6.3 Not in scope

- OpenClaw core CLI subcommands  
- Replacing OpenClaw’s own skill installer  

---

## 7. Doctor / health messaging

### 7.1 No doctor binary today

Grok’s `memex doctor` does not exist here. v1 health surfaces:

| Surface | When | Content |
|---------|------|---------|
| Service-start logs | gateway start | `shared-origin`, projection summary, conflict count |
| Offline script | manual / CI | same checks as structured JSON optional |
| Optional future `pnpm doctor` | follow-on | port Grok check names if operators want parity |

### 7.2 Checks (names align with Grok for fleet readability)

| Check | Severity guidance | Message intent (OpenClaw-specific) |
|-------|-------------------|--------------------------------------|
| `shared-origin` | OK if origin exists; WARN if profile set but missing; WARN on legacy-claude/xdg sources | Origin present / source / migrate hint |
| `rules-projection` | OK if profile idle; WARN if profile set + pending links or conflicts | Links into origin; **never clobber** list |
| `memory-surface` | OK when plugin `enabled` and at least empty-or-configured memory path policy is understood | **“memory/rules/skills = semantic index + graduated inject (before_prompt_build); not MCP tools”** — honest for this harness |
| `scan-policy` | OK when projection active implies origin/rules **not** also in scan list | One blob → one index entry |

Do **not** FAIL the plugin solely because projection was never run — advisory until dogfood SLA says otherwise.

---

## 8. Index / scan policy (no double-index)

### 8.1 Today

`ruleDirs: []`. Skills may already be real trees under managed/workspace skills. There is **no** sync-repo append path in this adapter (unlike pre-projection Grok `index-init` which appended `syncRepoDir/rules`).

### 8.2 When projection profile is set

```text
ruleDirs  = [ ~/.openclaw/rules ]   // after ensuring dir; links resolve to origin content
skillDirs = existing list unchanged for v1
memoryDirs = config.memoryDirs unchanged
```

**Never** also append `join(originRoot, "rules")` to `ruleDirs` or `skillDirs`.

### 8.3 When projection profile is not set

Keep today’s `ruleDirs: []` (no silent new scan roots). Operators who hand-create `~/.openclaw/rules` without enabling sync get no automatic scan until we document an explicit opt-in — **v1 keeps scan of `~/.openclaw/rules` gated on `sync.enabled`** to avoid surprise indexing of an unprojected empty dir. (If review prefers “always scan if present”, that is a one-line design flip; default here is **profile-gated** for least surprise.)

### 8.4 First-start ordering

Preferred: project (idempotent) **then** `index.build`. If projection fails non-fatally (conflicts partial), still build index on successful links + skills/memory; log WARN for conflicts.

---

## 9. Fail-closed / coexistence

| Case | Behavior |
|------|----------|
| Target missing | `mkdir` via plan `ensureDirs` + create absolute symlink |
| Correct link already | noop |
| Managed link, origin moved | relink when `relinkManaged: true` |
| Real file/dir at target name | **conflict** — leave in place; report; do not clobber |
| Foreign symlink | conflict |
| Operator local-only rules mixed with managed names | only conflicting basenames blocked; other links still apply (partial apply) |

No copy-only fallback in v1 (provenance must be `readlink`-obvious). Windows junction policy is core’s problem; dogfood is Linux first.

---

## 10. Implementation sketch (post-gate only)

Ordered; **blocked until this design is gated**:

1. **Bump** `@jim80net/memex-core` to `^0.6.0`; lockfile refresh; fix any type breakages from 0.3→0.6.  
2. **`src/paths.ts`** — centralize `OPENCLAW_DIR`, cache paths, `MANAGED_SKILLS_DIR`, `globalRulesDir = join(OPENCLAW_DIR, "rules")` (export for tests).  
3. **`src/projection.ts`** — port of Grok’s thin wrapper:  
   - `isProjectionProfileSet`  
   - `buildOpenClawProjectionTargets`  
   - `runOpenClawProjection`  
   - `rulesProjectionActive`  
4. **`src/config.ts` + `openclaw.plugin.json`** — parse optional `sync` block; defaults safe (`enabled: false`).  
5. **`src/index.ts`** — service start: project → projection-aware `buildScanDirs` → index build; log health.  
6. **Offline script** — dry-run / strict for dogfood.  
7. **Tests** — temp origin + harness dirs: create / noop / real-file conflict / no double-scan.  
8. **Docs** — README section “Shared-origin rules projection”; CLAUDE.md scan table update.  
9. **Dogfood / manual verify** (§11).

---

## 11. Dogfood / verify plan

No dedicated “openclaw-research” flotilla desk is bound in hierarchy for this seat the way grok-research is. Verify path:

### 11.1 Automated (required for impl PR)

- Unit tests with temp dirs (no live gateway).  
- `pnpm check` green on the impl branch.

### 11.2 Manual (on a host with OpenClaw + this plugin)

1. Ensure origin has at least one rule: e.g. `$ORIGIN/rules/dogfood-rule.md`.  
2. Set plugin config: `enabled: true`, `sync.enabled: true` (optional `sync.repoDir`).  
3. Run offline script `--strict` **or** restart OpenClaw gateway so service start projects.  
4. Prove provenance:
   ```bash
   ls -la ~/.openclaw/rules
   readlink -f ~/.openclaw/rules/dogfood-rule.md   # → under origin
   ```
5. Conflict drill: create a real file at a managed basename → re-run projection → file untouched; WARN/conflict listed.  
6. Runtime: enable plugin; send a prompt that should match the rule; confirm inject log mentions the rule (existing router logging).  
7. Confirm index does not list the same rule twice (search / telemetry / skillCount sanity).

### 11.3 Success criteria (adapter chapter)

- [ ] This design gated by memex.  
- [ ] Impl PR: pin 0.6.0 + projection + scan policy + tests.  
- [ ] Manual verify: `readlink` → origin; conflict non-clobber; inject still works.  
- [ ] No new inject path; no origin-layout fork.  
- [ ] Skills projection left as explicit follow-on unless design gate expands scope.

---

## 12. Comparison to Grok proven path (delta table)

| Concern | Grok (#30/#31) | OpenClaw (this addendum) |
|---------|----------------|---------------------------|
| Core APIs | same | same |
| Rules target | `~/.grok/rules` (pre-existing scan) | `~/.openclaw/rules` (**new** under verified home; becomes `ruleDirs`) |
| Project rules | optional explicit origin rel dir | same caution; v1 global only |
| Profile config | `~/.grok/memex.json` `sync.enabled` | OpenClaw plugin config `sync.enabled` |
| Primary entry | `memex init` / `memex sync` CLI | plugin service start + offline script |
| Doctor | `memex doctor` checks | start logs + offline script; optional later CLI |
| Memory surface messaging | MCP tools, not inject | **Inject index** (existing); not MCP |
| Pre-projection scan of origin | had syncRepoDir append risk | no origin append today — keep it that way |
| Core pin at design | 0.6.0 | still ^0.3.1 → bump at impl |

---

## 13. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Inventing non-harness paths | Anchor under verified `OPENCLAW_DIR` / `workspaceDir`; document as memex-managed |
| Double-index | Profile-gated `ruleDirs`; never scan raw origin rules |
| Gateway start writes surprise | `sync.enabled` default false |
| Core 0.3→0.6 breakage (largest jump) | §1.6 audit; single impl PR preferred; split only if pin-alone fails |
| Silent portable-location / cache skew | Keep 3-arg `SkillIndex`; no registry without design |
| Accidental `~/.memex` migrate | CoS C: never call migrate helpers in v1 defaults |
| Operators expect Grok-style MCP memory copy | Health message: file corpus + graduated inject (this harness) |
| No live OpenClaw desk in flotilla | Manual verify checklist + unit tests as gate bar |
| Clobber user files in `~/.openclaw/rules` | core fail-closed; never ship copy fallback |

---

## 14. Coordination / backlog settle markers

### For memex (flotilla XO)

- Gate this design PR (systems-review bar).  
- After gate: authorize impl against `@jim80net/memex-core@^0.6.0`.  
- Merge authority remains with memex (author ≠ merger).

### ## Backlog (LIVE wave — not standby)

| Marker | Item | Owner |
|--------|------|-------|
| `[live] settle: design-pr-16` | Design PR #16 open + CoS scope/pin-jump sections; await memex gate. | memex (gate) / memex-openclaw (author) |
| `[live] settle: impl-after-design-gate` | **After gate:** pin `^0.6.0` + projection + scan/health + tests → impl PR → memex gate. | memex-openclaw |
| `[live] settle: pin-A-tests-green` | Track A: no silent skew; `pnpm check` green on 0.6; residual cache/type issues called out in impl PR. | memex-openclaw |
| `[live] settle: projection-B-files` | Track B: file-shaped rules via core plan/apply into `~/.openclaw/rules`; no new inject paths. | memex-openclaw |
| `[live] settle: migrate-C-opt-in-only` | Track C: default resolver-only; no mass `~/.memex` migrate. | memex-openclaw |
| `[follow-on] settle: skills-projection` | Project origin `skills/` → `MANAGED_SKILLS_DIR` via `entryKind: "skill-dirs"`. | memex-openclaw |
| `[follow-on] settle: workspace-rules-scope` | Optional project-scoped origin rules → `workspaceDir/rules` without double-index. | memex-openclaw |
| `[follow-on] settle: doctor-cli-parity` | Optional `pnpm doctor` mirroring Grok check names. | memex-openclaw |
| `[non-goal] settle: inject-first` | Do not redesign delivery as inject-first product or MCP-primary. | — |
| `[non-goal] settle: origin-fork` | Do not invent OpenClaw-private origin corpus layout. | — |
| `[non-goal] settle: self-merge-freeze` | No self-merge; no freeze-SHA; no codex-memex-dev cutover. | — |

---

## 15. References (read for this draft)

- Flotilla: `~/workspace/memex-flotilla/briefs/adapter-alignment-g3-2026-07-11.md`  
- Flotilla: `~/workspace/memex-flotilla/briefs/file-rules-shared-origin-2026-07-10.md`  
- Grok design: `memex-grok/docs/superpowers/specs/2026-07-10-file-rules-symlink-init.md`  
- Grok impl: `memex-grok/src/core/projection.ts`, `src/cli/doctor.ts`, `src/core/paths.ts`  
- Core: `memex-core/src/origin.ts`, `memex-core/src/types.ts` (`ProjectionTarget`, `SyncProfile`), `memex-core/design/shared-origin-sync-profile.md`  
- This package: `src/index.ts`, `src/config.ts`, `src/router.ts`, `openclaw.plugin.json`, `README.md`, `CLAUDE.md`, `package.json`  
- Dogfood capture (Grok): `memex-flotilla/demos/dogfood-projection-2026-07-10.txt`  
