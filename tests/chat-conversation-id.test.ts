import { describe, expect, test } from "bun:test";
import { Chat } from "../src/chat.js";
import { user } from "../src/chat.js";

function headerValue(
  opts: { headers?: Headers | Record<string, string> } | undefined,
  name: string,
): string | undefined {
  if (!opts?.headers) return undefined;
  const h = opts.headers;
  if (typeof Headers !== "undefined" && h instanceof Headers) {
    return h.get(name) ?? undefined;
  }
  const rec = h as Record<string, string>;
  return rec[name] ?? rec[name.toLowerCase()];
}

function mockCompletionResponse() {
  return {
    id: "resp_1",
    outputs: [
      {
        index: 0,
        finishReason: 1,
        message: {
          role: 2,
          content: "hi",
          reasoningContent: "",
          encryptedContent: "",
          toolCalls: [],
          citations: [],
        },
      },
    ],
    model: "grok-4",
    systemFingerprint: "",
    citations: [],
    outputFiles: [],
    serviceTier: 0,
    usage: {
      promptTextTokens: 10,
      cachedPromptTextTokens: 0,
    },
  };
}

describe("conversationId sticky cache header", () => {
  test("sends x-grok-conv-id on getCompletion when conversationId is set", async () => {
    const calls: Array<{ headers?: Headers | Record<string, string> }> = [];
    const stub = {
      async getCompletion(_req: unknown, opts?: { headers?: Headers | Record<string, string> }) {
        calls.push(opts ?? {});
        return mockCompletionResponse();
      },
    };

    const chat = new Chat(stub as never, "conv_test", undefined, {
      model: "grok-4",
      messages: [user("hello")],
      storeMessages: false,
    });
    await chat.sample();
    expect(calls.length).toBe(1);
    expect(headerValue(calls[0], "x-grok-conv-id")).toBe("conv_test");
  });

  test("omits x-grok-conv-id when conversationId is unset", async () => {
    const calls: Array<{ headers?: Headers | Record<string, string> }> = [];
    const stub = {
      async getCompletion(_req: unknown, opts?: { headers?: Headers | Record<string, string> }) {
        calls.push(opts ?? {});
        return mockCompletionResponse();
      },
    };

    const chat = new Chat(stub as never, undefined, undefined, {
      model: "grok-4",
      messages: [user("hello")],
      storeMessages: false,
    });
    await chat.sample();
    expect(headerValue(calls[0], "x-grok-conv-id")).toBeUndefined();
    // callOptions returns undefined entirely when no conversationId
    expect(calls[0]?.headers).toBeUndefined();
  });

  test("sends x-grok-conv-id on stream getCompletionChunk", async () => {
    const calls: Array<{ headers?: Headers | Record<string, string> }> = [];
    const stub = {
      getCompletionChunk(_req: unknown, opts?: { headers?: Headers | Record<string, string> }) {
        calls.push(opts ?? {});
        return (async function* () {
          yield {
            id: "resp_stream",
            outputs: [
              {
                index: 0,
                finishReason: 1,
                delta: {
                  role: 2,
                  content: "x",
                  reasoningContent: "",
                  encryptedContent: "",
                  toolCalls: [],
                  citations: [],
                },
              },
            ],
            model: "grok-4",
            systemFingerprint: "",
            citations: [],
            outputFiles: [],
            serviceTier: 0,
          };
        })();
      },
    };

    const chat = new Chat(stub as never, "stream_conv", undefined, {
      model: "grok-4",
      messages: [user("stream me")],
    });
    for await (const _ of chat.stream()) {
      // drain
    }
    expect(calls.length).toBe(1);
    expect(headerValue(calls[0], "x-grok-conv-id")).toBe("stream_conv");
  });

  test("sends x-grok-conv-id on deferred start + poll", async () => {
    const calls: Array<{ method: string; headers?: Headers | Record<string, string> }> = [];
    const stub = {
      async startDeferredCompletion(
        _req: unknown,
        opts?: { headers?: Headers | Record<string, string> },
      ) {
        calls.push({ method: "start", ...(opts ?? {}) });
        return { requestId: "def_1" };
      },
      async getDeferredCompletion(
        _req: unknown,
        opts?: { headers?: Headers | Record<string, string> },
      ) {
        calls.push({ method: "get", ...(opts ?? {}) });
        return {
          status: 1, // DeferredStatus.DONE
          response: mockCompletionResponse(),
        };
      },
    };

    // Import DeferredStatus value to be safe
    const { DeferredStatus } = await import("../src/gen/xai/api/v1/deferred_pb.js");
    stub.getDeferredCompletion = async (_req, opts) => {
      calls.push({ method: "get", ...(opts ?? {}) });
      return {
        status: DeferredStatus.DONE,
        response: mockCompletionResponse(),
      };
    };

    const chat = new Chat(stub as never, "defer_conv", undefined, {
      model: "grok-4",
      messages: [user("defer")],
    });
    await chat.defer();
    expect(calls.some((c) => c.method === "start")).toBe(true);
    expect(calls.some((c) => c.method === "get")).toBe(true);
    for (const c of calls) {
      expect(headerValue(c, "x-grok-conv-id")).toBe("defer_conv");
    }
  });

  test("storeMessages default remains false", () => {
    const chat = new Chat({} as never, "c", undefined, {
      model: "grok-4",
      messages: [user("x")],
    });
    // proto default when not set in create path is via ChatClient; here settings omit it
    expect(chat.proto.storeMessages ?? false).toBe(false);
  });
});

describe("per-call headers vs client metadata", () => {
  test("chat conversationId wins over client-wide x-grok-conv-id metadata", async () => {
    const { authInterceptor } = await import("../src/transport.js");
    const interceptor = authInterceptor("k", { "x-grok-conv-id": "client-wide", "user-agent": "ua" });

    const req = { header: new Headers() } as { header: Headers };
    req.header.set("x-grok-conv-id", "per-chat");

    await interceptor((async (r: unknown) => r) as never)(req as never);

    expect(req.header.get("x-grok-conv-id")).toBe("per-chat");
    expect(req.header.get("user-agent")).toBe("ua");
    expect(req.header.get("Authorization")).toBe("Bearer k");
  });

  test("client metadata still applies when the chat sets no conversationId", async () => {
    const { authInterceptor } = await import("../src/transport.js");
    const interceptor = authInterceptor("k", { "x-grok-conv-id": "client-wide" });

    const req = { header: new Headers() } as { header: Headers };
    await interceptor((async (r: unknown) => r) as never)(req as never);

    expect(req.header.get("x-grok-conv-id")).toBe("client-wide");
  });
});
