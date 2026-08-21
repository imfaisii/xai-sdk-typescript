import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const SRC_DIR = resolve(import.meta.dir, "../src");

/** Matches static `import ... from "spec"` / `export ... from "spec"` declarations.
 * Deliberately does not match `import("spec")` dynamic calls (no `from` keyword),
 * so runtime-guarded dynamic imports (e.g. files.ts's node:fs/promises) are ignored. */
function extractStaticImportSpecifiers(content: string): string[] {
  const re = /\b(?:import|export)\s+[\s\S]*?\bfrom\s+["']([^"']+)["']/g;
  const specifiers: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    specifiers.push(m[1]!);
  }
  return specifiers;
}

function resolveRelativeSpecifier(fromFile: string, specifier: string): string {
  let resolved = resolve(dirname(fromFile), specifier);
  if (resolved.endsWith(".js")) resolved = `${resolved.slice(0, -3)}.ts`;
  return resolved;
}

/** Walk the static (non-dynamic) import graph from `entry`, collecting visited
 * local files and bare (package) specifiers referenced anywhere in the graph. */
function collectImportGraph(entry: string): { files: Set<string>; externals: Set<string> } {
  const files = new Set<string>();
  const externals = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    const content = readFileSync(file, "utf8");
    for (const spec of extractStaticImportSpecifiers(content)) {
      if (spec.startsWith(".")) {
        const resolved = resolveRelativeSpecifier(file, spec);
        if (existsSync(resolved)) stack.push(resolved);
      } else {
        externals.add(spec);
      }
    }
  }
  return { files, externals };
}

describe("web entry point does not pull in Node-only code", () => {
  test("static import graph from src/index-web.ts has no node: specifiers or connect-node", () => {
    const entry = join(SRC_DIR, "index-web.ts");
    const { files, externals } = collectImportGraph(entry);

    // Sanity: the graph actually walked into the SDK's resource clients.
    expect(files.size).toBeGreaterThan(10);

    for (const spec of externals) {
      expect(spec.startsWith("node:")).toBe(false);
      expect(spec).not.toBe("@connectrpc/connect-node");
    }

    // The Node-only modules must never be reachable from the web entry point.
    const fileNames = new Set([...files].map((f) => f.split("/").pop()));
    expect(fileNames.has("env.ts")).toBe(false);
    expect(fileNames.has("transport.ts")).toBe(false);
    expect(fileNames.has("client.ts")).toBe(false);
  });

  test("Bun.build with target: browser succeeds and the output has no connect-node", async () => {
    const result = await Bun.build({
      entrypoints: [join(SRC_DIR, "index-web.ts")],
      target: "browser",
    });

    expect(result.success).toBe(true);
    expect(result.logs.length).toBe(0);

    const output = await result.outputs[0]!.text();
    expect(output.includes("connect-node")).toBe(false);
  });
});

describe("src/transport-web.ts resolveConfig", () => {
  test("throws a helpful error when no apiKey is available", async () => {
    const { resolveConfig } = await import("../src/transport-web.js");
    const prev = process.env.XAI_API_KEY;
    delete process.env.XAI_API_KEY;
    try {
      expect(() => resolveConfig({})).toThrow(/apiKey.*Worker secret/s);
    } finally {
      if (prev === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = prev;
    }
  });

  test("does not mention .env files (web has no dotenv loading)", async () => {
    const { resolveConfig } = await import("../src/transport-web.js");
    const prev = process.env.XAI_API_KEY;
    delete process.env.XAI_API_KEY;
    try {
      expect(() => resolveConfig({})).toThrow();
      try {
        resolveConfig({});
      } catch (e) {
        expect(String(e)).not.toMatch(/\.env/);
      }
    } finally {
      if (prev === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = prev;
    }
  });

  test("accepts an explicit apiKey", async () => {
    const { resolveConfig } = await import("../src/transport-web.js");
    const cfg = resolveConfig({ apiKey: "test-key", apiHost: "localhost:50051", useInsecureChannel: true });
    expect(cfg.apiKey).toBe("test-key");
    expect(cfg.apiHost).toBe("localhost:50051");
  });

  test("falls back to process.env.XAI_API_KEY when present", async () => {
    const { resolveConfig } = await import("../src/transport-web.js");
    const prev = process.env.XAI_API_KEY;
    process.env.XAI_API_KEY = "from-process-env";
    try {
      const cfg = resolveConfig({});
      expect(cfg.apiKey).toBe("from-process-env");
    } finally {
      if (prev === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = prev;
    }
  });
});

describe("shared authInterceptor, reached via the web transport", () => {
  test("per-call headers (e.g. x-grok-conv-id) win over client metadata", async () => {
    const { authInterceptor } = await import("../src/transport-web.js");
    const interceptor = authInterceptor("k", { "x-grok-conv-id": "client-wide", "user-agent": "ua" });

    const req = { header: new Headers() } as { header: Headers };
    req.header.set("x-grok-conv-id", "per-call");

    await interceptor((async (r: unknown) => r) as never)(req as never);

    expect(req.header.get("x-grok-conv-id")).toBe("per-call");
    expect(req.header.get("user-agent")).toBe("ua");
    expect(req.header.get("Authorization")).toBe("Bearer k");
  });

  test("client metadata still applies when there is no per-call override", async () => {
    const { authInterceptor } = await import("../src/transport-web.js");
    const interceptor = authInterceptor("k", { "x-grok-conv-id": "client-wide" });

    const req = { header: new Headers() } as { header: Headers };
    await interceptor((async (r: unknown) => r) as never)(req as never);

    expect(req.header.get("x-grok-conv-id")).toBe("client-wide");
  });
});
