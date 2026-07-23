#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CORE_VERSION = "0.7.1";
const TRANSFORMERS_VERSION = "3.8.1";
const SAFE_SHARP_VERSION = "0.35.3";
const SAFE_TAR_VERSION = "7.5.21";
const SAFE_PROTOBUFJS_VERSION = "7.6.5";
const MODEL = "Xenova/all-MiniLM-L6-v2";
const MODEL_CACHE =
  process.env.MEMEX_MODEL_CACHE_DIR ?? join(homedir(), ".cache", "memex-openclaw-models");

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status})\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout.trim();
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function installedPackageVersion(root, packageName) {
  const manifest = JSON.parse(
    readFileSync(join(root, "node_modules", packageName, "package.json"), "utf8"),
  );
  return manifest.version;
}

function assertSingleSharp(root, expectedVersion) {
  const output = run("npm", ["ls", "sharp", "--all", "--parseable"], root);
  const installs = [
    ...new Set(
      output
        .split(/\r?\n/)
        .filter((line) => /[/\\]node_modules[/\\]sharp$/.test(line))
        .map((line) => realpathSync(line)),
    ),
  ];
  if (installs.length !== 1) {
    throw new Error(`expected exactly one Sharp installation, found ${installs.length}`);
  }
  const version = JSON.parse(readFileSync(join(installs[0], "package.json"), "utf8")).version;
  if (version !== expectedVersion) {
    throw new Error(`expected Sharp ${expectedVersion}, found ${version}`);
  }
  return installs[0];
}

function assertAuditZero(root) {
  const result = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  });
  const report = JSON.parse(result.stdout);
  const vulnerabilities = report.metadata?.vulnerabilities;
  if (result.status !== 0 || !vulnerabilities || vulnerabilities.total !== 0) {
    throw new Error(
      `npm audit --omit=dev reported findings\n${JSON.stringify(vulnerabilities, null, 2)}`,
    );
  }
  return vulnerabilities;
}

function packAdapter(destination) {
  const output = run(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", destination],
    ROOT,
  );
  const jsonStart = output.indexOf("[");
  if (jsonStart === -1) {
    throw new Error(`npm pack did not return JSON: ${output}`);
  }
  const packed = JSON.parse(output.slice(jsonStart));
  if (!Array.isArray(packed) || packed.length !== 1 || typeof packed[0].filename !== "string") {
    throw new Error(`unexpected npm pack response: ${output}`);
  }
  return join(destination, packed[0].filename);
}

function installFixture(root, manifest) {
  writeJson(join(root, "package.json"), manifest);
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], root);
}

function verifyStockGuard(tempRoot) {
  const fixture = join(tempRoot, "stock");
  mkdirSync(fixture, { recursive: true });
  installFixture(fixture, {
    name: "memex-openclaw-stock-security-fixture",
    private: true,
    type: "module",
    dependencies: {
      "@huggingface/transformers": TRANSFORMERS_VERSION,
      "@jim80net/memex-core": CORE_VERSION,
    },
  });

  const stockSharp = assertSingleSharp(fixture, "0.34.5");
  const runner = join(fixture, "verify-stock.mjs");
  writeFileSync(
    runner,
    `import { createRequire } from "node:module";
import { LocalEmbeddingProvider } from "@jim80net/memex-core";

const require = createRequire(import.meta.url);
const before = new Set(Object.keys(require.cache));
let rejected = false;
try {
  await new LocalEmbeddingProvider().embed(["guard the stock graph"]);
} catch (error) {
  rejected = /vulnerable sharp 0\\.34\\.5.*sharp >=0\\.35\\.0.*GHSA-f88m-g3jw-g9cj/.test(
    String(error),
  );
}
const loadedSharpModules = Object.keys(require.cache).filter(
  (path) =>
    /(?:sharp|@img)[/\\\\]/.test(path) &&
    !path.endsWith("sharp/package.json") &&
    !before.has(path),
);
if (!rejected) throw new Error("Core did not reject the stock vulnerable Sharp graph");
if (loadedSharpModules.length !== 0) {
  throw new Error(\`Sharp loaded before the guard: \${loadedSharpModules.join(", ")}\`);
}
console.log(JSON.stringify({ rejected, loadedSharpModules }));
`,
  );
  const guard = JSON.parse(run(process.execPath, [runner], fixture));
  return { sharpPath: stockSharp, ...guard };
}

function verifySafePackedRuntime(tempRoot, tarball) {
  const fixture = join(tempRoot, "safe");
  mkdirSync(fixture, { recursive: true });
  installFixture(fixture, {
    name: "memex-openclaw-safe-security-fixture",
    private: true,
    type: "module",
    dependencies: {
      "@jim80net/memex-openclaw": `file:${tarball}`,
    },
    overrides: {
      sharp: SAFE_SHARP_VERSION,
      tar: SAFE_TAR_VERSION,
      protobufjs: SAFE_PROTOBUFJS_VERSION,
    },
  });

  const audit = assertAuditZero(fixture);
  const sharpPath = assertSingleSharp(fixture, SAFE_SHARP_VERSION);
  const runner = join(fixture, "verify-safe.mjs");
  writeFileSync(
    runner,
    `import { LocalEmbeddingProvider } from "@jim80net/memex-core";

const provider = new LocalEmbeddingProvider(${JSON.stringify(MODEL)}, ${JSON.stringify(
      MODEL_CACHE,
    )});
const vectors = await provider.embed(["memex openclaw security acceptance"]);
const vector = vectors[0];
if (!Array.isArray(vector) || vector.length !== 384 || !vector.every(Number.isFinite)) {
  throw new Error("local embedding did not yield a finite vector");
}
const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
if (Math.abs(norm - 1) > 0.001) {
  throw new Error(\`local embedding was not normalized: \${norm}\`);
}
console.log(JSON.stringify({ dimensions: vector.length, finite: true, norm }));
`,
  );
  const embedding = JSON.parse(run(process.execPath, [runner], fixture));

  return {
    audit,
    embedding,
    sharpPath,
    coreVersion: installedPackageVersion(fixture, "@jim80net/memex-core"),
  };
}

const tempRoot = mkdtempSync(join(tmpdir(), "memex-openclaw-core-security-"));
try {
  const tarball = packAdapter(tempRoot);
  const stock = verifyStockGuard(tempRoot);
  const safe = verifySafePackedRuntime(tempRoot, tarball);
  if (safe.coreVersion !== CORE_VERSION) {
    throw new Error(`expected Core ${CORE_VERSION}, found ${safe.coreVersion}`);
  }
  console.log(
    JSON.stringify(
      {
        core: safe.coreVersion,
        safeSharp: SAFE_SHARP_VERSION,
        stock,
        safe,
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
