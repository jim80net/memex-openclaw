# Claude Code Instructions

## Project

OpenClaw plugin for the memex skill/memory/rule router. Core engine lives in `@jim80net/memex-core`. Ships as an OpenClaw plugin (TypeScript, loaded at runtime).

## Development

```bash
pnpm install --ignore-scripts   # skip onnxruntime postinstall
pnpm test                       # run vitest
pnpm tsc --noEmit               # type check
pnpm check                      # lint + typecheck + test
```

## Architecture

- `@jim80net/memex-core` — Shared engine (separate repo): embeddings, skill-index, origin projection (`resolveOriginRoot` / `planProjection` / `applyProjection`), cache, session, telemetry, traces, types
- `src/config.ts` — Extends `MemexCoreConfig` with openclaw defaults + optional `sync` projection profile
- `src/paths.ts` — OpenClaw path constants (`~/.openclaw`, cache, managed skills, global rules)
- `src/projection.ts` — Thin wrapper over core projection APIs (G3 shared-origin)
- `src/scan-dirs.ts` — Projection-aware `ScanDirs` (no double-index origin + harness)
- `src/router.ts` — Graduated disclosure logic: rules (full then reminder), memories (always full), skills (teaser only)
- `src/index.ts` — Plugin entry: service-start projection + index build; hooks (before_prompt_build, before_tool_call, agent_end)
- `src/prompt-extractor.ts` — Strips OpenClaw/Discord envelope metadata; `isHeartbeatPrompt()`
- `test/` — Vitest tests for router, prompt-extractor, projection

### Scan sources

| Source | Workspace path | Global path | Config path |
|--------|---------------|-------------|-------------|
| Skills | `<workspace>/skills/*/SKILL.md` | `~/.openclaw/workspace/skills/*/SKILL.md` | `config.skillDirs` |
| Rules | — | `~/.openclaw/rules/*.md` when `sync.enabled` (symlinks into origin) | `config.sync` |
| Memory | — | — | `config.memoryDirs` |

### Disclosure model

Frontmatter fields: `name`, `description`, `type`, `one-liner`, `queries`, `boost` (optional float added to similarity score before threshold comparison).

- **Rules**: full content on first match in session, one-liner reminder on subsequent matches
- **Skills/workflows**: description teaser only; agent reads the SKILL.md if it chooses to use it
- **Memory**: full content always (they're short)

### Cache paths

All openclaw-specific state lives under `~/.openclaw/cache/`:
- `skill-router.json` — embedding cache
- `skill-router-telemetry.json` — match telemetry (fields: `queryHits` per-query hit counts, `observations` for injected results)
- `skill-router-traces/` — execution traces
- `models/` — ONNX model cache

## Conventions

- Core engine (`@jim80net/memex-core`) is a separate npm package — all shared types, embeddings, indexing, caching live there
- Tests mock `SkillIndex` methods to avoid filesystem/embedding side effects in router tests
- Prompt extractor tests use realistic OpenClaw/Discord envelope fixtures
- All openclaw-specific paths are centralized in `src/paths.ts`
- Core pin: `@jim80net/memex-core@^0.6.0` — do not reimplement symlink policy in the adapter
- Design: `docs/design/2026-07-11-g3-adapter-alignment-file-rules.md`
