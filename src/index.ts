import type { EmbeddingProvider, Logger } from "@jim80net/memex-core";
import {
  InMemorySessionTracker,
  LocalEmbeddingProvider,
  OpenAIEmbeddingProvider,
  SkillIndex,
  TraceAccumulator,
} from "@jim80net/memex-core";
import manifest from "../openclaw.plugin.json" with { type: "json" };
import { resolveConfig } from "./config.ts";
import { getOpenClawPaths } from "./paths.ts";
import { runOpenClawProjection } from "./projection.ts";
import type { HookContext, HookEvent } from "./router.ts";
import { createRouter } from "./router.ts";
import { buildScanDirs } from "./scan-dirs.ts";

// ---------------------------------------------------------------------------
// OpenClaw plugin API types
// ---------------------------------------------------------------------------

type OpenClawConfig = {
  workspace?: {
    dir?: string;
  };
};

type OpenClawPluginApi = {
  id: string;
  config: OpenClawConfig;
  pluginConfig?: Record<string, unknown>;
  logger: Logger;
  on: (event: string, handler: (...args: unknown[]) => unknown, opts?: unknown) => void;
  registerService: (service: { id: string; start: () => Promise<void>; stop: () => void }) => void;
};

// ---------------------------------------------------------------------------
// Hook event/context types
// ---------------------------------------------------------------------------

type ToolCallEvent = {
  toolName: string;
  toolInput?: Record<string, unknown>;
  sessionKey?: string;
};

type ToolCallContext = {
  agentId?: string;
  sessionKey?: string;
};

type AgentEndEvent = {
  sessionKey?: string;
  agentId?: string;
  messageCount?: number;
  error?: string;
  outcome?: string;
};

// ---------------------------------------------------------------------------
// Tool guidance query builder
// ---------------------------------------------------------------------------

function buildToolQuery(toolName: string, toolInput?: Record<string, unknown>): string {
  if (!toolInput) return `using ${toolName} tool`;

  // Extract context based on tool type
  let context = "";
  switch (toolName) {
    case "exec":
      context = typeof toolInput.command === "string" ? toolInput.command.slice(0, 200) : "";
      break;
    case "Read":
    case "Write":
    case "Edit":
      context =
        typeof toolInput.file_path === "string" || typeof toolInput.path === "string"
          ? String(toolInput.file_path ?? toolInput.path)
          : "";
      break;
    case "message":
      context = typeof toolInput.action === "string" ? `${toolInput.action}` : "";
      if (typeof toolInput.channel === "string") context += ` on ${toolInput.channel}`;
      break;
    case "web_search":
    case "web_fetch":
      context =
        typeof toolInput.query === "string" || typeof toolInput.url === "string"
          ? String(toolInput.query ?? toolInput.url).slice(0, 200)
          : "";
      break;
    case "sessions_spawn":
      context = typeof toolInput.task === "string" ? toolInput.task.slice(0, 200) : "";
      break;
    default:
      // Generic: use first string value
      for (const val of Object.values(toolInput)) {
        if (typeof val === "string" && val.length > 3) {
          context = val.slice(0, 200);
          break;
        }
      }
  }

  return context ? `using ${toolName}: ${context}` : `using ${toolName} tool`;
}

// ---------------------------------------------------------------------------
// Health / projection summary logs (doctor equivalent for plugin)
// ---------------------------------------------------------------------------

function logProjectionHealth(
  logger: Logger,
  report: Awaited<ReturnType<typeof runOpenClawProjection>>,
): void {
  if (!report.profileSet) {
    logger.info("Memex[health]: rules-projection idle (sync.enabled=false)");
    logger.info(
      "Memex[health]: memory-surface = file-shaped corpus + graduated inject (before_prompt_build), not MCP tools",
    );
    return;
  }
  if (report.origin) {
    const src = report.origin.source;
    const legacyLike = src === "legacy-claude" || src === "xdg";
    logger.info(
      `Memex[health]: shared-origin ${report.origin.exists ? "present" : "missing"} at ${report.origin.root} (source=${src})${legacyLike ? " — product default is ~/.memex; migrate is opt-in only" : ""}`,
    );
  }
  logger.info(`Memex[health]: rules-projection ${report.message}`);
  if (report.apply && report.apply.conflicts.length > 0) {
    const sample = report.apply.conflicts
      .slice(0, 3)
      .map((c) => `${c.targetPath} (${c.reason})`)
      .join("; ");
    logger.warn(
      `Memex[health]: ${report.apply.conflicts.length} conflict(s) — real files not clobbered: ${sample}`,
    );
  }
  logger.info(
    "Memex[health]: memory-surface = file-shaped corpus + graduated inject (before_prompt_build), not MCP tools",
  );
}

// ---------------------------------------------------------------------------
// Plugin entry point
// ---------------------------------------------------------------------------

export default function register(api: OpenClawPluginApi): void {
  const config = resolveConfig(api.pluginConfig);
  const paths = getOpenClawPaths();

  if (!config.enabled && !config.sync.enabled) {
    api.logger.info("Memex disabled");
    return;
  }

  // Create embedding provider only when router inject is enabled
  let provider: EmbeddingProvider | null = null;
  let index: SkillIndex | null = null;
  let sessionTracker: InMemorySessionTracker | null = null;
  let traceAccumulator: TraceAccumulator | null = null;

  if (config.enabled) {
    if (config.embeddingBackend === "openai") {
      const apiKey = process.env.OPENAI_API_KEY ?? "";
      if (!apiKey) {
        api.logger.warn(
          "Memex: openai backend selected but no OPENAI_API_KEY, falling back to local",
        );
        provider = new LocalEmbeddingProvider(config.embeddingModel, paths.modelsDir);
      } else {
        provider = new OpenAIEmbeddingProvider(config.embeddingModel, apiKey);
        api.logger.info(`Memex: using OpenAI embeddings (${config.embeddingModel})`);
      }
    } else {
      provider = new LocalEmbeddingProvider(config.embeddingModel, paths.modelsDir);
      api.logger.info(`Memex: using local ONNX embeddings (${config.embeddingModel})`);
    }

    // 3-arg SkillIndex — no portable-location registry (design §1.6 no silent skew)
    index = new SkillIndex(config, provider, paths.cachePath);
    sessionTracker = new InMemorySessionTracker();
    traceAccumulator = new TraceAccumulator(paths.tracesDir);
    const router = createRouter(index, config, api.logger, sessionTracker, {
      traceAccumulator,
      telemetryPath: paths.telemetryPath,
      buildScanDirs: (workspaceDir) => buildScanDirs(workspaceDir, config, paths),
    });

    // --- Hook: before_prompt_build ---
    api.on("before_prompt_build", async (event: unknown, context: unknown) => {
      return router(event as HookEvent, context as HookContext);
    });

    // --- Hook: before_tool_call ---
    api.on("before_tool_call", async (event: unknown, context: unknown) => {
      const toolEvent = event as ToolCallEvent;
      const toolContext = context as ToolCallContext;
      const toolName = toolEvent.toolName;
      if (!toolName) return undefined;

      const sessionKey = toolContext.sessionKey ?? toolEvent.sessionKey ?? "";
      if (sessionKey && traceAccumulator) {
        traceAccumulator.recordToolCall(sessionKey, toolName);
      }

      if (!config.enabled || !index?.skillCount) return undefined;

      const query = buildToolQuery(toolName, toolEvent.toolInput);

      try {
        const results = await index.search(query, 2, config.threshold + 0.1, ["tool-guidance"]);

        if (results.length === 0) return undefined;

        let totalChars = 0;
        const sections: string[] = [];

        for (const result of results) {
          let content: string;
          try {
            content = await index.readSkillContent(result.skill.location);
          } catch {
            continue;
          }

          if (totalChars + content.length > 4000) break;

          sections.push(
            `## Tool Guidance: ${result.skill.name} (relevance: ${(result.score * 100).toFixed(0)}%)\n\n${content}`,
          );
          totalChars += content.length;
        }

        if (sections.length === 0) return undefined;

        api.logger.info(
          `Memex[tool]: injected ${sections.length} guidance(s) for ${toolName} (${totalChars} chars)`,
        );

        return { prependContext: sections.join("\n\n---\n\n") };
      } catch (err) {
        api.logger.warn(`Memex[tool]: search failed: ${err}`);
        return undefined;
      }
    });

    // --- Hook: agent_end ---
    api.on("agent_end", async (event: unknown) => {
      const endEvent = event as AgentEndEvent;
      const sessionKey = endEvent.sessionKey ?? "";
      if (!sessionKey || !traceAccumulator) return;

      if (endEvent.messageCount) {
        traceAccumulator.recordMessageCount(sessionKey, endEvent.messageCount);
      }

      const outcome = endEvent.error
        ? "error"
        : endEvent.outcome === "timeout"
          ? "timeout"
          : "completed";

      try {
        const trace = await traceAccumulator.finalize(sessionKey, outcome, endEvent.error);
        if (trace && trace.skillsInjected.length > 0) {
          api.logger.info(
            `Memex[trace]: ${sessionKey} — ${trace.outcome}, skills=[${trace.skillsInjected.join(",")}], tools=${trace.toolsCalled.length}, msgs=${trace.messageCount}`,
          );
        }
      } catch (err) {
        api.logger.warn(`Memex[trace]: failed to finalize: ${err}`);
      }
    });
  }

  // --- Service: projection + index builder ---
  api.registerService({
    id: "memex-openclaw-index",
    start: async () => {
      const workspaceDir = api.config?.workspace?.dir;

      // Projection first when profile set (idempotent; fail-closed no-clobber)
      try {
        const report = await runOpenClawProjection({
          config,
          workspaceDir,
          paths,
        });
        logProjectionHealth(api.logger, report);
      } catch (err) {
        api.logger.warn(`Memex: projection failed: ${err}`);
      }

      if (config.enabled && index && workspaceDir) {
        api.logger.info("Memex: building initial index...");
        try {
          await index.build(buildScanDirs(workspaceDir, config, paths));
          api.logger.info(`Memex: indexed ${index.skillCount} skills`);
        } catch (err) {
          api.logger.warn(`Memex: failed to build initial index: ${err}`);
        }
      }
    },
    stop: () => {
      api.logger.info("Memex: stopped");
    },
  });

  // Periodic cleanup of stale trace and session entries (every 30 min)
  if (traceAccumulator && sessionTracker) {
    const ta = traceAccumulator;
    const st = sessionTracker;
    const cleanupInterval = setInterval(() => {
      ta.cleanup();
      st.cleanup();
    }, 1800_000);

    if (typeof cleanupInterval === "object" && "unref" in cleanupInterval) {
      (cleanupInterval as NodeJS.Timeout).unref();
    }
  }

  api.logger.info(
    `Memex v${manifest.version}: registered (enabled=${config.enabled} sync.enabled=${config.sync.enabled})`,
  );
}

export type { SkillRouterConfig } from "./config.ts";
export { DEFAULT_CONFIG, resolveConfig } from "./config.ts";
export { getOpenClawPaths } from "./paths.ts";
export {
  buildOpenClawProjectionTargets,
  isProjectionProfileSet,
  rulesProjectionActive,
  runOpenClawProjection,
} from "./projection.ts";
// Re-export for offline scripts / tests
export { buildScanDirs } from "./scan-dirs.ts";
