import { describe, expect, test } from "bun:test";
import { toJson } from "@bufbuild/protobuf";
import { Chat, Response, user } from "../src/chat.js";
import { MessageSchema } from "../src/gen/xai/api/v1/chat_pb.js";

function chat() {
  return new Chat({} as never, undefined, undefined, {
    model: "grok-4",
    messages: [user("hi")],
  });
}

function assistantOutput(over: Record<string, unknown> = {}) {
  return {
    index: 0,
    finishReason: 1,
    message: {
      role: 2,
      content: "answer",
      reasoningContent: "",
      encryptedContent: "",
      toolCalls: [],
      citations: [],
      ...over,
    },
  };
}

function toolOutput() {
  return {
    index: 0,
    finishReason: 1,
    message: {
      role: 5, // ROLE_TOOL
      content: "tool output",
      reasoningContent: "",
      encryptedContent: "",
      toolCalls: [{ id: "call_1", function: { name: "f", arguments: "{}" } }],
      citations: [],
    },
  };
}

function baseResponse(outputs: unknown[]) {
  return {
    id: "resp",
    outputs,
    model: "grok-4",
    systemFingerprint: "",
    citations: [],
    outputFiles: [],
    serviceTier: 0,
  };
}

describe("append preserves an exact cache prefix", () => {
  test("empty reasoningContent stays unset in both single- and multi-output branches", () => {
    // multi-output branch: a ROLE_TOOL output forces index === null replay
    const multi = chat();
    multi.append(new Response(baseResponse([assistantOutput(), toolOutput()]) as never, null));

    const single = chat();
    single.append(new Response(baseResponse([assistantOutput()]) as never, 0));

    const multiAssistant = multi.messages[1]!;
    const singleAssistant = single.messages[1]!;

    // reasoning_content is `optional` in the proto: "" set != unset on the wire.
    expect(multiAssistant.reasoningContent).toBeUndefined();
    expect(singleAssistant.reasoningContent).toBeUndefined();
    expect(toJson(MessageSchema, multiAssistant)).toEqual(toJson(MessageSchema, singleAssistant));
  });

  test("non-empty reasoningContent round-trips in the multi-output branch", () => {
    const c = chat();
    c.append(
      new Response(
        baseResponse([assistantOutput({ reasoningContent: "because" }), toolOutput()]) as never,
        null,
      ),
    );
    expect(c.messages[1]!.reasoningContent).toBe("because");
  });

  test("tool call id round-trips onto the replayed tool message", () => {
    const c = chat();
    c.append(new Response(baseResponse([assistantOutput(), toolOutput()]) as never, null));
    const toolMessage = c.messages[2]!;
    expect(toolMessage.toolCallId).toBe("call_1");
  });

  test("append only ever grows the message list at the end", () => {
    const c = chat();
    const first = c.messages[0];
    c.append(new Response(baseResponse([assistantOutput()]) as never, 0));
    c.append(user("next"));
    expect(c.messages[0]).toBe(first!);
    expect(c.messages.length).toBe(3);
  });
});
