import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const LOADED = new Set<string>();

/**
 * Parse a dotenv-style file body into key/value pairs.
 * Supports optional `export ` prefix, single/double quotes, and `#` comments.
 */
export function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const cleaned = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = cleaned.indexOf("=");
    if (eq <= 0) continue;
    const key = cleaned.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = cleaned.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      // strip inline comments for unquoted values: KEY=val # comment
      const hash = value.indexOf(" #");
      if (hash >= 0) value = value.slice(0, hash).trimEnd();
    }
    out[key] = value;
  }
  return out;
}

function envMode(): string | undefined {
  const mode = process.env.XAI_ENV ?? process.env.NODE_ENV;
  return mode && mode.trim() ? mode.trim() : undefined;
}

/**
 * Dotenv files to try, lowest → highest precedence among files.
 * Existing `process.env` values are never overwritten.
 *
 * - `.env`
 * - `.env.<mode>` (mode from `XAI_ENV` or `NODE_ENV`, e.g. production/staging/development)
 * - any other `.env.*` in the directory except `.env.example` / `.env*.sample` (by name sort)
 * - `.env.local`
 * - `.env.<mode>.local`
 */
export function listEnvFiles(dir: string): string[] {
  const mode = envMode();
  const preferred: string[] = [".env"];
  if (mode) preferred.push(`.env.${mode}`);

  let extras: string[] = [];
  try {
    extras = readdirSync(dir)
      .filter((name) => {
        if (!name.startsWith(".env")) return false;
        if (name === ".env") return false;
        if (name.endsWith(".example") || name.endsWith(".sample") || name.endsWith(".template")) {
          return false;
        }
        // skip local files here; added last for highest file precedence
        if (name === ".env.local" || name.endsWith(".local")) return false;
        if (mode && name === `.env.${mode}`) return false;
        // .env.production, .env.staging, .env.development, custom suffixes
        return name.startsWith(".env.");
      })
      .sort();
  } catch {
    extras = [];
  }

  const locals: string[] = [".env.local"];
  if (mode) locals.push(`.env.${mode}.local`);

  const ordered = [...preferred, ...extras, ...locals];
  // de-dupe while preserving order
  const seen = new Set<string>();
  const files: string[] = [];
  for (const name of ordered) {
    if (seen.has(name)) continue;
    seen.add(name);
    files.push(join(dir, name));
  }
  return files;
}

/**
 * Load dotenv files from `dir` (default: cwd) into `process.env`.
 * Keys already present in the process environment (shell export, host env)
 * are never overwritten. Among dotenv files, later files win (e.g. `.env.local`
 * overrides `.env`). Safe to call multiple times for the same directory.
 */
export function loadEnvFiles(dir: string = process.cwd()): void {
  const root = dir || process.cwd();
  if (LOADED.has(root)) return;
  LOADED.add(root);

  // Snapshot keys that were already set before any file load.
  const preexisting = new Set(
    Object.keys(process.env).filter((k) => process.env[k] !== undefined),
  );

  for (const filePath of listEnvFiles(root)) {
    if (!existsSync(filePath)) continue;
    let content: string;
    try {
      content = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const parsed = parseEnvFile(content);
    for (const [key, value] of Object.entries(parsed)) {
      if (preexisting.has(key)) continue;
      process.env[key] = value;
    }
  }
}

/** Test helper: allow reloading after cwd / file changes in unit tests. */
export function _resetEnvLoaderForTests(): void {
  LOADED.clear();
}

/**
 * Resolve a secret: explicit option → process.env → dotenv files → undefined.
 */
export function resolveSecret(
  optionValue: string | undefined,
  envName: string,
  options?: { envDir?: string },
): string | undefined {
  if (optionValue !== undefined) return optionValue;
  if (process.env[envName] !== undefined && process.env[envName] !== "") {
    return process.env[envName];
  }
  loadEnvFiles(options?.envDir ?? process.cwd());
  const fromFile = process.env[envName];
  return fromFile && fromFile !== "" ? fromFile : undefined;
}
