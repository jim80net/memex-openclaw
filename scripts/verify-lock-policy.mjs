#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_PACKAGE_MANAGER = "pnpm@10.34.5";
const CANONICAL_LOCKFILE = "pnpm-lock.yaml";
const LOCKFILE_NAMES = new Set([
  CANONICAL_LOCKFILE,
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
]);
const IGNORED_DIRECTORIES = new Set([".git", ".pnpm", "node_modules"]);
const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(process.env.MEMEX_LOCK_POLICY_ROOT ?? SCRIPT_ROOT);

function findLockfiles(directory) {
  const lockfiles = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) lockfiles.push(...findLockfiles(path));
    } else if (entry.isFile() && LOCKFILE_NAMES.has(entry.name)) {
      lockfiles.push(relative(ROOT, path));
    }
  }
  return lockfiles;
}

const manifestPath = join(ROOT, "package.json");
if (!existsSync(manifestPath)) throw new Error(`missing package.json at ${manifestPath}`);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.packageManager !== EXPECTED_PACKAGE_MANAGER) {
  throw new Error(
    `packageManager must be exactly ${EXPECTED_PACKAGE_MANAGER}; found ${String(manifest.packageManager)}`,
  );
}

const lockfiles = findLockfiles(ROOT).sort();
if (lockfiles.length !== 1 || lockfiles[0] !== CANONICAL_LOCKFILE) {
  throw new Error(
    `expected only ${CANONICAL_LOCKFILE}; found ${lockfiles.length ? lockfiles.join(", ") : "none"}`,
  );
}

console.log(`${EXPECTED_PACKAGE_MANAGER}; canonical lockfile: ${CANONICAL_LOCKFILE}`);
