import { describe, expect, test } from "bun:test";
import pkg from "../package.json";
import { create } from "@bufbuild/protobuf";
import {
  text,
  user,
  system,
  assistant,
  toolResult,
  tool,
  requiredTool,
  image,
  file,
} from "../src/chat.js";
import { SearchParameters, webSource, newsSource, xSource, rssSource } from "../src/search.js";
import {
  webSearch,
  xSearch,
  codeExecution,
  collectionsSearch,
  mcp,
  functionTool,
  getToolCallType,
} from "../src/tools.js";
import { costUsdFromTicks, costUsdFromUsage, TICKS_PER_USD } from "../src/cost.js";
import { serviceTierToProto, serviceTierFromProto } from "../src/service-tier.js";
import { ServiceTier } from "../src/gen/xai/api/v1/usage_pb.js";
import { MessageRole } from "../src/gen/xai/api/v1/chat_pb.js";
import { PollTimer } from "../src/util.js";
import { VERSION } from "../src/version.js";
import { resolveConfig } from "../src/transport.js";
import { BatchRequestSchema } from "../src/batch.js";
import { XAIError } from "../src/errors.js";
import { parseEnvFile, loadEnvFiles, _resetEnvLoaderForTests } from "../src/env.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("version", () => {
  test("exposes package version", () => {
    expect(VERSION).toBe(pkg.version);
  });
});

describe("message helpers", () => {
  test("text content", () => {
    const c = text("hello");
    expect(c.content.case).toBe("text");
    expect(c.content.value).toBe("hello");
  });

  test("user/system/assistant/toolResult", () => {
    expect(user("hi").role).toBe(MessageRole.ROLE_USER);
    expect(system("sys").role).toBe(MessageRole.ROLE_SYSTEM);
    expect(assistant("ok").role).toBe(MessageRole.ROLE_ASSISTANT);
    const tr = toolResult("result", "call_1");
    expect(tr.role).toBe(MessageRole.ROLE_TOOL);
    expect(tr.toolCallId).toBe("call_1");
  });

  test("image and file content", () => {
    const img = image("https://example.com/a.png", { detail: "high" });
    expect(img.content.case).toBe("imageUrl");
    const f = file({ fileId: "file_abc" });
    expect(f.content.case).toBe("file");
  });

  test("function tool + requiredTool", () => {
    const t = tool("get_weather", "Get weather", {
      type: "object",
      properties: { city: { type: "string" } },
    });
    expect(t.tool.case).toBe("function");
    const choice = requiredTool("get_weather");
    expect(choice.toolChoice.case).toBe("functionName");
  });
});

describe("tools helpers", () => {
  test("built-in tools", () => {
    expect(webSearch().tool.case).toBe("webSearch");
    expect(xSearch().tool.case).toBe("xSearch");
    expect(codeExecution().tool.case).toBe("codeExecution");
    expect(collectionsSearch({ collectionIds: ["c1"] }).tool.case).toBe("collectionsSearch");
    expect(mcp({ serverUrl: "https://example.com/mcp" }).tool.case).toBe("mcp");
    expect(functionTool("fn", "desc", { type: "object" }).tool.case).toBe("function");
  });

  test("getToolCallType", () => {
    const name = getToolCallType({ type: 1 } as never);
    expect(typeof name).toBe("string");
  });
});

describe("search parameters", () => {
  test("builds proto with sources", () => {
    const sp = new SearchParameters({
      mode: "auto",
      sources: [webSource(), newsSource(), xSource({ includedXHandles: ["xai"] }), rssSource("https://example.com/rss")],
      returnCitations: true,
      maxSearchResults: 5,
    });
    const pb = sp.toProto();
    expect(pb.sources.length).toBe(4);
    expect(pb.maxSearchResults).toBe(5);
  });
});

describe("cost", () => {
  test("ticks to usd", () => {
    expect(TICKS_PER_USD).toBe(10_000_000_000);
    expect(costUsdFromTicks(TICKS_PER_USD)).toBe(1);
    expect(costUsdFromUsage({ costInUsdTicks: BigInt(TICKS_PER_USD / 2) } as never)).toBe(0.5);
  });
});

describe("service tier", () => {
  test("roundtrip", () => {
    expect(serviceTierToProto("priority")).toBe(ServiceTier.PRIORITY);
    expect(serviceTierFromProto(ServiceTier.DEFAULT)).toBe("default");
  });
});

describe("env file parsing", () => {
  test("parseEnvFile handles quotes, export, comments", () => {
    const parsed = parseEnvFile(`
# comment
export XAI_API_KEY="key-from-dotenv"
XAI_MANAGEMENT_KEY='mgmt'
OTHER=plain # trailing
`);
    expect(parsed.XAI_API_KEY).toBe("key-from-dotenv");
    expect(parsed.XAI_MANAGEMENT_KEY).toBe("mgmt");
    expect(parsed.OTHER).toBe("plain");
  });
});

describe("transport config", () => {
  test("requires api key when nothing is set", () => {
    const prev = process.env.XAI_API_KEY;
    delete process.env.XAI_API_KEY;
    _resetEnvLoaderForTests();
    const emptyDir = mkdtempSync(join(tmpdir(), "xai-sdk-empty-"));
    try {
      expect(() => resolveConfig({ envDir: emptyDir })).toThrow(/API key not found/);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
      if (prev === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = prev;
      _resetEnvLoaderForTests();
    }
  });

  test("accepts explicit key", () => {
    const cfg = resolveConfig({ apiKey: "test-key", apiHost: "localhost:50051", useInsecureChannel: true });
    expect(cfg.apiKey).toBe("test-key");
    expect(cfg.apiHost).toBe("localhost:50051");
    expect(cfg.metadata["xai-sdk-version"]).toMatch(/^js\//);
  });

  test("loads XAI_API_KEY from .env.local when process env is unset", () => {
    const prev = process.env.XAI_API_KEY;
    delete process.env.XAI_API_KEY;
    _resetEnvLoaderForTests();
    const dir = mkdtempSync(join(tmpdir(), "xai-sdk-env-"));
    try {
      writeFileSync(join(dir, ".env"), "XAI_API_KEY=from-env\n");
      writeFileSync(join(dir, ".env.local"), "XAI_API_KEY=from-local\n");
      const cfg = resolveConfig({ envDir: dir });
      expect(cfg.apiKey).toBe("from-local");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      if (prev === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = prev;
      // clear value injected by loadEnvFiles into process.env
      if (prev === undefined) delete process.env.XAI_API_KEY;
      _resetEnvLoaderForTests();
    }
  });

  test("exported process.env wins over dotenv files", () => {
    const prev = process.env.XAI_API_KEY;
    process.env.XAI_API_KEY = "from-shell";
    _resetEnvLoaderForTests();
    const dir = mkdtempSync(join(tmpdir(), "xai-sdk-env2-"));
    try {
      writeFileSync(join(dir, ".env"), "XAI_API_KEY=from-file\n");
      const cfg = resolveConfig({ envDir: dir });
      expect(cfg.apiKey).toBe("from-shell");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      if (prev === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = prev;
      _resetEnvLoaderForTests();
    }
  });

  test("loads .env.production when NODE_ENV=production", () => {
    const prevKey = process.env.XAI_API_KEY;
    const prevNode = process.env.NODE_ENV;
    delete process.env.XAI_API_KEY;
    process.env.NODE_ENV = "production";
    _resetEnvLoaderForTests();
    const dir = mkdtempSync(join(tmpdir(), "xai-sdk-env3-"));
    try {
      writeFileSync(join(dir, ".env"), "XAI_API_KEY=base\n");
      writeFileSync(join(dir, ".env.production"), "XAI_API_KEY=prod\n");
      const cfg = resolveConfig({ envDir: dir });
      expect(cfg.apiKey).toBe("prod");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      if (prevKey === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = prevKey;
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
      _resetEnvLoaderForTests();
    }
  });
});

describe("batch request schema", () => {
  test("create empty batch request shell", () => {
    const req = create(BatchRequestSchema, {
      batchRequestId: "r1",
    });
    expect(req.batchRequestId).toBe("r1");
  });
});

describe("errors", () => {
  test("fromUnknown wraps Error", () => {
    const e = XAIError.fromUnknown(new Error("boom"));
    expect(e).toBeInstanceOf(XAIError);
    expect(e.message).toBe("boom");
  });
});

describe("PollTimer", () => {
  test("times out", async () => {
    const t = new PollTimer({ timeoutMs: 20, intervalMs: 30, maxIntervalMs: 30 });
    await expect(t.waitOrThrow("timed out")).rejects.toThrow(/timed out/);
  });
});
