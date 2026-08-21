import { create } from "@bufbuild/protobuf";
import type { Client as ConnectClient } from "@connectrpc/connect";
import { BatchRequestSchema, type BatchRequest } from "./gen/xai/api/v1/batch_pb.js";
import {
  AgentCount,
  Chat as ChatService,
  CompactContextRequestSchema,
  ContentSchema,
  DeleteStoredCompletionRequestSchema,
  FileContentSchema,
  FormatType,
  FunctionSchema,
  GetCompletionsRequestSchema,
  GetStoredCompletionRequestSchema,
  IncludeOption,
  MessageRole,
  MessageSchema,
  ReasoningEffort,
  ResponseFormatSchema,
  ToolCallStatus,
  ToolCallType,
  ToolChoiceSchema,
  ToolMode,
  ToolSchema,
  type CompactContextResponse as CompactContextResponseProto,
  type CompletionOutput,
  type Content,
  type GetChatCompletionChunk,
  type GetChatCompletionResponse,
  type GetCompletionsRequest,
  type InlineCitation,
  type LogProbs,
  type Message,
  type RequestSettings,
  type ResponseFormat,
  type SearchParameters as SearchParametersProto,
  type Tool,
  type ToolCall,
  type ToolChoice,
} from "./gen/xai/api/v1/chat_pb.js";
import {
  DeferredStatus,
  GetDeferredRequestSchema,
} from "./gen/xai/api/v1/deferred_pb.js";
import {
  ImageDetail,
  ImageUrlContentSchema,
} from "./gen/xai/api/v1/image_pb.js";
import { FinishReason } from "./gen/xai/api/v1/sample_pb.js";
import { ServerSideTool, type SamplingUsage, type ServiceTier as ServiceTierEnum } from "./gen/xai/api/v1/usage_pb.js";
import { costUsdFromUsage } from "./cost.js";
import { SearchParameters } from "./search.js";
import { serviceTierFromProto, serviceTierToProto, type ServiceTierName } from "./service-tier.js";
import { PollTimer } from "./util.js";

export type ChatModel =
  | "grok-4"
  | "grok-4-0709"
  | "grok-4-latest"
  | "grok-4-1-fast"
  | "grok-4-1-fast-reasoning"
  | "grok-4-1-fast-reasoning-latest"
  | "grok-4-1-fast-non-reasoning"
  | "grok-4-1-fast-non-reasoning-latest"
  | "grok-4-fast"
  | "grok-4-fast-reasoning"
  | "grok-4-fast-reasoning-latest"
  | "grok-4-fast-non-reasoning"
  | "grok-4-fast-non-reasoning-latest"
  | "grok-4.20-0309-reasoning"
  | "grok-4.20"
  | "grok-4.20-0309"
  | "grok-4.20-reasoning-latest"
  | "grok-4.20-0309-non-reasoning"
  | "grok-4.20-non-reasoning"
  | "grok-4.20-non-reasoning-latest"
  | "grok-4.20-multi-agent"
  | "grok-4.20-multi-agent-0309"
  | "grok-4.20-multi-agent-latest"
  | "grok-4.3"
  | "grok-4.3-latest"
  | "grok-4.5"
  | "grok-4.5-latest"
  | "grok-4.6"
  | "grok-code-fast-1"
  | "grok-build-0.1"
  | "grok-3"
  | "grok-3-latest"
  | "grok-3-mini"
  | "grok-3-fast"
  | "grok-3-fast-latest"
  | "grok-3-mini-fast"
  | "grok-3-mini-fast-latest";

export type ReasoningEffortName = "none" | "low" | "medium" | "high" | "xhigh";
export type ToolModeName = "auto" | "none" | "required";
export type ResponseFormatName = "text" | "json_object" | "json_schema";
export type ImageDetailName = "auto" | "low" | "high";
export type IncludeOptionName =
  | "web_search_call_output"
  | "x_search_call_output"
  | "code_execution_call_output"
  | "collections_search_call_output"
  | "attachment_search_call_output"
  | "mcp_call_output"
  | "inline_citations"
  | "verbose_streaming"
  | "code_execution_files_output";

export type ContentInput = string | Content;

function processContent(content: ContentInput): Content {
  if (typeof content === "string") return text(content);
  return content;
}

export function text(content: string): Content {
  return create(ContentSchema, { content: { case: "text", value: content } });
}

export function image(imageUrl: string, options?: { detail?: ImageDetailName }): Content {
  let detail = ImageDetail.DETAIL_AUTO;
  if (options?.detail === "low") detail = ImageDetail.DETAIL_LOW;
  else if (options?.detail === "high") detail = ImageDetail.DETAIL_HIGH;
  return create(ContentSchema, {
    content: {
      case: "imageUrl",
      value: create(ImageUrlContentSchema, { source: { case: "imageUrl", value: imageUrl }, detail }),
    },
  });
}

export function file(options: {
  fileId?: string;
  data?: Uint8Array;
  url?: string;
  filename?: string;
  mimeType?: string;
}): Content {
  const provided = [options.fileId, options.data, options.url].filter((x) => x !== undefined).length;
  if (provided !== 1) {
    throw new Error("Exactly one of `fileId`, `data`, or `url` must be set.");
  }
  if (options.fileId !== undefined) {
    if (options.filename !== undefined || options.mimeType !== undefined) {
      throw new Error("`filename`/`mimeType` are only supported for inline uploads (`data`) or URL (`url`).");
    }
    return create(ContentSchema, {
      content: { case: "file", value: create(FileContentSchema, { fileId: options.fileId }) },
    });
  }
  return create(ContentSchema, {
    content: {
      case: "file",
      value: create(FileContentSchema, {
        data: options.data,
        url: options.url ?? "",
        filename: options.filename ?? "",
        mimeType: options.mimeType ?? "",
      }),
    },
  });
}

export function user(...args: ContentInput[]): Message {
  return create(MessageSchema, {
    role: MessageRole.ROLE_USER,
    content: args.map(processContent),
  });
}

export function assistant(...args: ContentInput[]): Message {
  return create(MessageSchema, {
    role: MessageRole.ROLE_ASSISTANT,
    content: args.map(processContent),
  });
}

export function system(...args: ContentInput[]): Message {
  return create(MessageSchema, {
    role: MessageRole.ROLE_SYSTEM,
    content: args.map(processContent),
  });
}

export function developer(...args: ContentInput[]): Message {
  return create(MessageSchema, {
    role: MessageRole.ROLE_DEVELOPER,
    content: args.map(processContent),
  });
}

export function toolResult(result: string, toolCallId?: string): Message {
  return create(MessageSchema, {
    role: MessageRole.ROLE_TOOL,
    content: [text(result)],
    toolCallId,
  });
}

/** Define a client-side function tool. */
export function tool(name: string, description: string, parameters: Record<string, unknown>): Tool {
  return create(ToolSchema, {
    tool: {
      case: "function",
      value: create(FunctionSchema, {
        name,
        description,
        parameters: JSON.stringify(parameters),
      }),
    },
  });
}

export function requiredTool(name: string): ToolChoice {
  return create(ToolChoiceSchema, {
    toolChoice: { case: "functionName", value: name },
  });
}

function reasoningEffortToProto(effort: ReasoningEffortName): ReasoningEffort {
  switch (effort) {
    case "none":
      return ReasoningEffort.EFFORT_NONE;
    case "low":
      return ReasoningEffort.EFFORT_LOW;
    case "medium":
      return ReasoningEffort.EFFORT_MEDIUM;
    case "high":
      return ReasoningEffort.EFFORT_HIGH;
    case "xhigh":
      return ReasoningEffort.EFFORT_XHIGH;
    default:
      throw new Error(`Invalid reasoning effort: ${effort}`);
  }
}

function toolModeToProto(mode: ToolModeName): ToolMode {
  switch (mode) {
    case "auto":
      return ToolMode.AUTO;
    case "none":
      return ToolMode.NONE;
    case "required":
      return ToolMode.REQUIRED;
    default:
      throw new Error(`Invalid tool mode: ${mode}`);
  }
}

function formatTypeToProto(format: ResponseFormatName): FormatType {
  switch (format) {
    case "text":
      return FormatType.TEXT;
    case "json_object":
      return FormatType.JSON_OBJECT;
    case "json_schema":
      return FormatType.JSON_SCHEMA;
    default:
      throw new Error(`Invalid response format: ${format}`);
  }
}

const INCLUDE_MAP: Record<IncludeOptionName, IncludeOption> = {
  web_search_call_output: IncludeOption.WEB_SEARCH_CALL_OUTPUT,
  x_search_call_output: IncludeOption.X_SEARCH_CALL_OUTPUT,
  code_execution_call_output: IncludeOption.CODE_EXECUTION_CALL_OUTPUT,
  collections_search_call_output: IncludeOption.COLLECTIONS_SEARCH_CALL_OUTPUT,
  attachment_search_call_output: IncludeOption.ATTACHMENT_SEARCH_CALL_OUTPUT,
  mcp_call_output: IncludeOption.MCP_CALL_OUTPUT,
  inline_citations: IncludeOption.INLINE_CITATIONS,
  verbose_streaming: IncludeOption.VERBOSE_STREAMING,
  code_execution_files_output: IncludeOption.CODE_EXECUTION_FILES_OUTPUT,
};

function includeOptionToProto(opt: IncludeOptionName | IncludeOption): IncludeOption {
  if (typeof opt !== "string") return opt;
  const v = INCLUDE_MAP[opt];
  if (v === undefined) throw new Error(`Invalid include option: ${opt}`);
  return v;
}

function agentCountToProto(n: 4 | 16 | AgentCount): AgentCount {
  if (n === 4) return AgentCount.AGENT_COUNT_4;
  if (n === 16) return AgentCount.AGENT_COUNT_16;
  return n as AgentCount;
}

function serverSideToolUsageFromProto(toolsUsed: ServerSideTool[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of toolsUsed) {
    const name = ServerSideTool[t] ?? "SERVER_SIDE_TOOL_INVALID";
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}

export class CompactContextResponse {
  constructor(readonly proto: CompactContextResponseProto) {}
  get id(): string {
    return this.proto.id;
  }
  get encryptedContent(): string {
    return this.proto.encryptedContent;
  }
  get droppedMessageCount(): number {
    return Number(this.proto.droppedMessageCount);
  }
  get usage(): SamplingUsage | undefined {
    return this.proto.usage;
  }
}

export class Chunk {
  constructor(
    readonly proto: GetChatCompletionChunk,
    private index: number | null,
  ) {}

  private get delta() {
    if (this.index === null) {
      const outs = this.proto.outputs.filter((o) => o.delta?.role === MessageRole.ROLE_ASSISTANT);
      return outs[outs.length - 1]?.delta;
    }
    return this.proto.outputs.find((o) => o.index === this.index)?.delta;
  }

  get content(): string {
    return this.delta?.content ?? "";
  }
  get reasoningContent(): string {
    return this.delta?.reasoningContent ?? "";
  }
  get toolCalls(): ToolCall[] {
    return this.delta?.toolCalls ?? [];
  }
  get citations(): string[] {
    return this.proto.citations;
  }
  get inlineCitations(): InlineCitation[] {
    return this.delta?.citations ?? [];
  }
  get serverSideToolUsage(): Record<string, number> {
    return serverSideToolUsageFromProto(this.proto.usage?.serverSideToolsUsed ?? []);
  }
}

/**
 * A single image produced by the server-side `imageGeneration` tool.
 *
 * Exposes the generated image as decoded `image` bytes (with `mimeType` and
 * `dataUrl` describing the payload), the `imageUuid` used to reference the
 * image in follow-up edit requests, and the completed `toolCall` that
 * produced it.
 */
export class ImageGenerationOutput {
  private readonly _toolCall: ToolCall;
  private readonly _dataUrl: string;
  private readonly _imageUuid: string;
  private readonly _image: Uint8Array;

  constructor(output: CompletionOutput, toolCall: ToolCall) {
    this._toolCall = toolCall;
    const content = output.message?.content ?? "";
    const errorMessage = `Output content is not a well-formed image generation result envelope: ${content.slice(0, 64)}`;
    let envelope: unknown;
    try {
      envelope = JSON.parse(content);
    } catch {
      throw new Error(errorMessage);
    }
    if (
      typeof envelope !== "object" ||
      envelope === null ||
      (envelope as Record<string, unknown>).__type !== "image_generation_result"
    ) {
      throw new Error(errorMessage);
    }
    const dataUrl = (envelope as Record<string, unknown>).result;
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/") || !dataUrl.includes("base64,")) {
      throw new Error(errorMessage);
    }
    this._dataUrl = dataUrl;
    const imageUuid = (envelope as Record<string, unknown>).image_uuid;
    this._imageUuid = typeof imageUuid === "string" ? imageUuid : "";
    const encoded = dataUrl.slice(dataUrl.indexOf("base64,") + "base64,".length);
    this._image = Buffer.from(encoded, "base64");
  }

  /**
   * The completed image generation tool call that produced this image.
   *
   * `toolCall.function.name` distinguishes text-to-image generations
   * (`imagine_text_to_image`) from image edits (`imagine_image_to_image`).
   */
  get toolCall(): ToolCall {
    return this._toolCall;
  }
  /** The generated image as a `data:<mime type>;base64,<payload>` URL. */
  get dataUrl(): string {
    return this._dataUrl;
  }
  /** The MIME type of the generated image (e.g. `image/jpeg`). */
  get mimeType(): string {
    return this._dataUrl.replace(/^data:/, "").split(";")[0] ?? "";
  }
  /**
   * The short reference ID the model uses to address this image in follow-up tool calls.
   *
   * Empty if the server did not report one.
   */
  get imageUuid(): string {
    return this._imageUuid;
  }
  /** The generated image as raw bytes. */
  get image(): Uint8Array {
    return this._image;
  }
}

export class Response {
  private contentBuffers = new Map<number, string[]>();
  private reasoningBuffers = new Map<number, string[]>();
  private encryptedBuffers = new Map<number, string[]>();
  private protoInSync = true;
  _index: number | null;

  constructor(
    private _proto: GetChatCompletionResponse,
    index: number | null,
  ) {
    this._index = index;
  }

  get proto(): GetChatCompletionResponse {
    this.syncBuffers();
    return this._proto;
  }

  private syncBuffers(): void {
    if (this.protoInSync) return;
    for (const [index, buffer] of this.contentBuffers) {
      const out = this._proto.outputs[index];
      if (out?.message && buffer.length) {
        out.message.content = buffer.join("");
        this.contentBuffers.set(index, [out.message.content]);
      }
    }
    for (const [index, buffer] of this.reasoningBuffers) {
      const out = this._proto.outputs[index];
      if (out?.message && buffer.length) {
        out.message.reasoningContent = buffer.join("");
        this.reasoningBuffers.set(index, [out.message.reasoningContent]);
      }
    }
    for (const [index, buffer] of this.encryptedBuffers) {
      const out = this._proto.outputs[index];
      if (out?.message && buffer.length) {
        out.message.encryptedContent = buffer.join("");
        this.encryptedBuffers.set(index, [out.message.encryptedContent]);
      }
    }
    this.protoInSync = true;
  }

  processChunk(chunk: GetChatCompletionChunk): void {
    if (chunk.usage) this._proto.usage = chunk.usage;
    if (chunk.created) this._proto.created = chunk.created;
    this._proto.id = chunk.id;
    this._proto.model = chunk.model;
    this._proto.systemFingerprint = chunk.systemFingerprint;
    if (chunk.serviceTier) this._proto.serviceTier = chunk.serviceTier;
    this._proto.citations.push(...chunk.citations);

    if (chunk.outputs.length) {
      const maxIndex = Math.max(...chunk.outputs.map((c) => c.index));
      while (this._proto.outputs.length <= maxIndex) {
        this._proto.outputs.push({
          $typeName: "xai_api.CompletionOutput",
          finishReason: FinishReason.REASON_INVALID,
          index: this._proto.outputs.length,
          message: {
            $typeName: "xai_api.CompletionMessage",
            content: "",
            reasoningContent: "",
            role: MessageRole.INVALID_ROLE,
            toolCalls: [],
            encryptedContent: "",
            citations: [],
          },
        } as CompletionOutput);
      }
    }

    for (const c of chunk.outputs) {
      const choice = this._proto.outputs[c.index]!;
      choice.index = c.index;
      if (c.delta) {
        if (!choice.message) {
          choice.message = {
            $typeName: "xai_api.CompletionMessage",
            content: "",
            reasoningContent: "",
            role: MessageRole.INVALID_ROLE,
            toolCalls: [],
            encryptedContent: "",
            citations: [],
          } as CompletionOutput["message"];
        }
        const msg = choice.message!;
        msg.role = c.delta.role;
        msg.toolCalls.push(...c.delta.toolCalls);
        msg.citations.push(...c.delta.citations);
        if (c.delta.content) {
          const buf = this.contentBuffers.get(c.index) ?? [];
          buf.push(c.delta.content);
          this.contentBuffers.set(c.index, buf);
          this.protoInSync = false;
        }
        if (c.delta.reasoningContent) {
          const buf = this.reasoningBuffers.get(c.index) ?? [];
          buf.push(c.delta.reasoningContent);
          this.reasoningBuffers.set(c.index, buf);
          this.protoInSync = false;
        }
        if (c.delta.encryptedContent) {
          const buf = this.encryptedBuffers.get(c.index) ?? [];
          buf.push(c.delta.encryptedContent);
          this.encryptedBuffers.set(c.index, buf);
          this.protoInSync = false;
        }
      }
      choice.finishReason = c.finishReason;
    }
  }

  private getOutput(sync = false): CompletionOutput {
    if (sync) this.syncBuffers();
    const outputs = this._proto.outputs.filter(
      (o) =>
        o.message?.role === MessageRole.ROLE_ASSISTANT &&
        (this._index === null || o.index === this._index),
    );
    return (
      outputs[outputs.length - 1] ??
      ({
        finishReason: FinishReason.REASON_INVALID,
        index: 0,
        message: {
          content: "",
          reasoningContent: "",
          role: MessageRole.INVALID_ROLE,
          toolCalls: [],
          encryptedContent: "",
          citations: [],
        },
      } as unknown as CompletionOutput)
    );
  }

  get id(): string {
    return this._proto.id;
  }
  get content(): string {
    return this.getOutput(true).message?.content ?? "";
  }
  get encryptedContent(): string {
    return this.getOutput(true).message?.encryptedContent ?? "";
  }
  get reasoningContent(): string {
    return this.getOutput(true).message?.reasoningContent ?? "";
  }
  get role(): string {
    const r = this.getOutput(false).message?.role ?? MessageRole.INVALID_ROLE;
    return MessageRole[r] ?? "INVALID_ROLE";
  }
  get usage(): SamplingUsage | undefined {
    return this._proto.usage;
  }
  get costUsd(): number | undefined {
    return costUsdFromUsage(this._proto.usage);
  }
  get finishReason(): string {
    const fr = this.getOutput(false).finishReason;
    return FinishReason[fr] ?? "REASON_INVALID";
  }
  get logprobs(): LogProbs | undefined {
    return this.getOutput(false).logprobs;
  }
  get systemFingerprint(): string {
    return this.proto.systemFingerprint;
  }
  get serviceTier(): ServiceTierName | undefined {
    return serviceTierFromProto(this.proto.serviceTier);
  }
  get toolCalls(): ToolCall[] {
    return this.proto.outputs
      .filter((o) => o.message?.role === MessageRole.ROLE_ASSISTANT)
      .flatMap((o) => o.message?.toolCalls ?? []);
  }
  get citations(): string[] {
    return this.proto.citations;
  }
  get inlineCitations(): InlineCitation[] {
    return this.proto.outputs
      .filter((o) => o.message?.role === MessageRole.ROLE_ASSISTANT)
      .flatMap((o) => o.message?.citations ?? []);
  }
  get toolOutputs(): CompletionOutput[] {
    return this.proto.outputs.filter((o) => o.message?.role === MessageRole.ROLE_TOOL);
  }
  /**
   * Returns the images generated by the server-side `imageGeneration` tool.
   *
   * One entry per completed image generation/edit call, in response order.
   * Failed calls carry an error payload instead of an image and are omitted.
   */
  get imageOutputs(): ImageGenerationOutput[] {
    const imageOutputs: ImageGenerationOutput[] = [];
    for (const output of this.toolOutputs) {
      const completedCalls = (output.message?.toolCalls ?? []).filter(
        (tc) => tc.type === ToolCallType.IMAGE_GENERATION_TOOL && tc.status === ToolCallStatus.COMPLETED,
      );
      if (completedCalls.length) {
        imageOutputs.push(new ImageGenerationOutput(output, completedCalls[0]!));
      }
    }
    return imageOutputs;
  }
  get serverSideToolUsage(): Record<string, number> {
    return serverSideToolUsageFromProto(this.proto.usage?.serverSideToolsUsed ?? []);
  }
  get requestSettings(): RequestSettings | undefined {
    return this.proto.settings;
  }
  get debugOutput() {
    return this.proto.debugOutput;
  }

  toString(): string {
    return this.content;
  }
}


export interface CreateChatOptions {
  model: ChatModel | (string & {});
  /**
   * Stable conversation id for prompt-cache sticky routing.
   * Sent as the `x-grok-conv-id` request header on every chat RPC for this Chat.
   * Use a UUID / session id and keep it constant for the whole multi-turn thread.
   * Does not auto-store messages; pair with `storeMessages` + `previousResponseId` for chaining.
   */
  conversationId?: string;
  messages?: Message[];
  user?: string;
  maxTokens?: number;
  seed?: number;
  stop?: string[];
  temperature?: number;
  topP?: number;
  logprobs?: boolean;
  topLogprobs?: number;
  tools?: Tool[];
  toolChoice?: ToolModeName | ToolChoice;
  parallelToolCalls?: boolean;
  responseFormat?: ResponseFormatName | ResponseFormat;
  frequencyPenalty?: number;
  presencePenalty?: number;
  reasoningEffort?: ReasoningEffortName | ReasoningEffort;
  searchParameters?: SearchParameters | SearchParametersProto;
  storeMessages?: boolean;
  previousResponseId?: string;
  useEncryptedContent?: boolean;
  maxTurns?: number;
  include?: Array<IncludeOptionName | IncludeOption>;
  agentCount?: 4 | 16 | AgentCount;
  batchRequestId?: string;
  serviceTier?: ServiceTierName | ServiceTierEnum;
}

/**
 * Recovers the `toolCallId` for replaying a completion output as an input message.
 *
 * `CompletionMessage` does not carry a `toolCallId` field, but server-side tool
 * outputs (ROLE_TOOL) echo the originating call in `toolCalls`. The server pairs
 * replayed tool turns with their calls via `Message.toolCallId` (e.g. to re-hydrate
 * binary tool results such as generated images), so it must be set when appending a
 * response back onto the conversation.
 */
function replayToolCallId(outputMessage: CompletionOutput["message"] | undefined): string | undefined {
  if (outputMessage?.role === MessageRole.ROLE_TOOL && outputMessage.toolCalls.length) {
    return outputMessage.toolCalls[0]!.id;
  }
  return undefined;
}

type ChatRpc = ConnectClient<typeof ChatService>;

export class Chat {
  readonly proto: GetCompletionsRequest;
  readonly conversationId?: string;
  readonly batchRequestId?: string;

  constructor(
    private stub: ChatRpc,
    conversationId: string | undefined,
    batchRequestId: string | undefined,
    settings: Partial<GetCompletionsRequest>,
  ) {
    this.proto = create(GetCompletionsRequestSchema, settings as never);
    this.conversationId = conversationId;
    this.batchRequestId = batchRequestId;
  }

  /**
   * Sticky prompt-cache routing header (xAI).
   * Connect merges these with client-level metadata; this value wins for `x-grok-conv-id`.
   */
  private callOptions(): { headers: Record<string, string> } | undefined {
    if (!this.conversationId) return undefined;
    return {
      headers: {
        "x-grok-conv-id": this.conversationId,
      },
    };
  }

  get messages(): Message[] {
    return this.proto.messages;
  }

  append(message: Message | Response | CompactContextResponse): this {
    if (message instanceof CompactContextResponse) {
      this.proto.messages = [
        create(MessageSchema, {
          role: MessageRole.ROLE_USER,
          encryptedContent: message.encryptedContent,
        }),
      ];
    } else if (message instanceof Response) {
      if (message._index === null) {
        for (const output of message.proto.outputs) {
          this.proto.messages.push(
            create(MessageSchema, {
              role: output.message?.role ?? MessageRole.ROLE_ASSISTANT,
              content: [text(output.message?.content ?? "")],
              reasoningContent: output.message?.reasoningContent || undefined,
              encryptedContent: output.message?.encryptedContent ?? "",
              toolCalls: output.message?.toolCalls ?? [],
              toolCallId: replayToolCallId(output.message),
            }),
          );
        }
      } else {
        const outputMessage = message.proto.outputs.find((o) => o.index === message._index)?.message;
        this.proto.messages.push(
          create(MessageSchema, {
            role: outputMessage?.role ?? MessageRole.ROLE_ASSISTANT,
            content: [text(message.content)],
            reasoningContent: message.reasoningContent || undefined,
            encryptedContent: message.encryptedContent,
            toolCalls: message.toolCalls,
            toolCallId: replayToolCallId(outputMessage),
          }),
        );
      }
    } else {
      this.proto.messages.push(message);
    }
    return this;
  }

  private makeRequest(n: number): GetCompletionsRequest {
    if (!this.proto.messages.length) {
      throw new Error(
        "Cannot create a completion request: No messages provided. Please include at least one message.",
      );
    }
    return create(GetCompletionsRequestSchema, { ...this.proto, n });
  }

  /** Build a BatchRequest for `client.batch.add(...)`. */
  prepare(n = 1): BatchRequest {
    return create(BatchRequestSchema, {
      batchRequestId: this.batchRequestId ?? "",
      request: { case: "completionRequest", value: this.makeRequest(n) },
    });
  }

  private usesServerSideTools(): boolean {
    return this.proto.tools.some((t) => t.tool.case !== "function" && t.tool.case !== undefined);
  }

  private autoDetectMultiOutputMode(
    index: number | null,
    outputs: Array<{ message?: { role: MessageRole } | undefined; delta?: { role: MessageRole } | undefined }>,
  ): number | null {
    if (index === null) return null;
    const hasToolRole = outputs.some(
      (o) => o.message?.role === MessageRole.ROLE_TOOL || o.delta?.role === MessageRole.ROLE_TOOL,
    );
    return hasToolRole ? null : index;
  }

  async sample(): Promise<Response> {
    let index: number | null = this.usesServerSideTools() ? null : 0;
    const responsePb = await this.stub.getCompletion(this.makeRequest(1), this.callOptions());
    index = this.autoDetectMultiOutputMode(index, responsePb.outputs);
    return new Response(responsePb, index);
  }

  async sampleBatch(n: number): Promise<Response[]> {
    const responsePb = await this.stub.getCompletion(this.makeRequest(n), this.callOptions());
    return Array.from({ length: n }, (_, i) => new Response(responsePb, i));
  }

  async *stream(): AsyncGenerator<[Response, Chunk], void, unknown> {
    let index: number | null = this.usesServerSideTools() ? null : 0;
    const response = new Response(
      {
        $typeName: "xai_api.GetChatCompletionResponse",
        id: "",
        outputs: [
          {
            $typeName: "xai_api.CompletionOutput",
            finishReason: FinishReason.REASON_INVALID,
            index: 0,
            message: {
              $typeName: "xai_api.CompletionMessage",
              content: "",
              reasoningContent: "",
              role: MessageRole.INVALID_ROLE,
              toolCalls: [],
              encryptedContent: "",
              citations: [],
            },
          } as CompletionOutput,
        ],
        model: "",
        systemFingerprint: "",
        citations: [],
        outputFiles: [],
        serviceTier: 0 as ServiceTierEnum,
      } as GetChatCompletionResponse,
      index,
    );

    const stream = this.stub.getCompletionChunk(this.makeRequest(1), this.callOptions());
    for await (const chunk of stream) {
      index = this.autoDetectMultiOutputMode(index, chunk.outputs);
      response._index = index;
      response.processChunk(chunk);
      yield [response, new Chunk(chunk, index)];
    }
  }

  async *streamBatch(n: number): AsyncGenerator<[Response[], Chunk[]], void, unknown> {
    const base: GetChatCompletionResponse = {
      $typeName: "xai_api.GetChatCompletionResponse",
      id: "",
      outputs: Array.from({ length: n }, (_, i) => ({
        $typeName: "xai_api.CompletionOutput",
        finishReason: FinishReason.REASON_INVALID,
        index: i,
        message: {
          $typeName: "xai_api.CompletionMessage",
          content: "",
          reasoningContent: "",
          role: MessageRole.INVALID_ROLE,
          toolCalls: [],
          encryptedContent: "",
          citations: [],
        },
      })) as CompletionOutput[],
      model: "",
      systemFingerprint: "",
      citations: [],
      outputFiles: [],
      serviceTier: 0 as ServiceTierEnum,
    } as GetChatCompletionResponse;
    const responses = Array.from({ length: n }, (_, i) => new Response(base, i));
    const stream = this.stub.getCompletionChunk(this.makeRequest(n), this.callOptions());
    for await (const chunk of stream) {
      responses[0]!.processChunk(chunk);
      yield [responses, Array.from({ length: n }, (_, i) => new Chunk(chunk, i))];
    }
  }

  async parse<T>(shape: {
    parse: (data: unknown) => T;
    schema?: unknown;
    jsonSchema?: unknown;
  }): Promise<[Response, T]>;
  async parse<T>(schema: Record<string, unknown>): Promise<[Response, T]>;
  async parse<T>(shapeOrSchema: { parse: (data: unknown) => T } | Record<string, unknown>): Promise<[Response, T]> {
    let schemaJson: string;
    let parseFn: (data: unknown) => T;

    if (typeof (shapeOrSchema as { parse?: unknown }).parse === "function") {
      const s = shapeOrSchema as {
        parse: (data: unknown) => T;
        jsonSchema?: unknown;
        schema?: unknown;
      };
      const js = s.jsonSchema ?? s.schema;
      schemaJson = JSON.stringify(js ?? {});
      parseFn = s.parse;
    } else {
      schemaJson = JSON.stringify(shapeOrSchema);
      parseFn = (data) => data as T;
    }

    this.proto.responseFormat = create(ResponseFormatSchema, {
      formatType: FormatType.JSON_SCHEMA,
      schema: schemaJson,
    });

    const responsePb = await this.stub.getCompletion(this.makeRequest(1), this.callOptions());
    let index: number | null = this.usesServerSideTools() ? null : 0;
    index = this.autoDetectMultiOutputMode(index, responsePb.outputs);
    const r = new Response(responsePb, index);
    const parsed = parseFn(JSON.parse(r.content));
    return [r, parsed];
  }

  private async deferInternal(
    n: number,
    timeoutMs?: number,
    intervalMs?: number,
  ): Promise<GetChatCompletionResponse> {
    const timer = new PollTimer({
      timeoutMs: timeoutMs ?? 10 * 60 * 1000,
      intervalMs: intervalMs ?? 100,
    });
    const opts = this.callOptions();
    const started = await this.stub.startDeferredCompletion(this.makeRequest(n), opts);
    while (true) {
      const r = await this.stub.getDeferredCompletion(
        create(GetDeferredRequestSchema, { requestId: started.requestId }),
        opts,
      );
      switch (r.status) {
        case DeferredStatus.DONE:
          if (!r.response) throw new Error("Deferred request done but response missing.");
          return r.response;
        case DeferredStatus.EXPIRED:
          throw new Error("Deferred request expired.");
        case DeferredStatus.PENDING:
          await timer.waitOrThrow("waiting for deferred chat completion");
          continue;
        default:
          throw new Error(`Unknown deferred status: ${r.status}`);
      }
    }
  }

  async defer(options?: { timeoutMs?: number; intervalMs?: number }): Promise<Response> {
    const response = await this.deferInternal(1, options?.timeoutMs, options?.intervalMs);
    return new Response(response, 0);
  }

  async deferBatch(n: number, options?: { timeoutMs?: number; intervalMs?: number }): Promise<Response[]> {
    const response = await this.deferInternal(n, options?.timeoutMs, options?.intervalMs);
    return Array.from({ length: n }, (_, i) => new Response(response, i));
  }

  async compact(): Promise<CompactContextResponse> {
    const responsePb = await this.stub.compactContext(
      create(CompactContextRequestSchema, {
        model: this.proto.model,
        input: this.proto.messages,
      }),
      this.callOptions(),
    );
    const result = new CompactContextResponse(responsePb);
    this.append(result);
    return result;
  }
}

export class ChatClient {
  constructor(private stub: ChatRpc) {}

  create(options: CreateChatOptions): Chat {
    let toolChoice: ToolChoice | undefined;
    if (typeof options.toolChoice === "string") {
      toolChoice = create(ToolChoiceSchema, {
        toolChoice: { case: "mode", value: toolModeToProto(options.toolChoice) },
      });
    } else {
      toolChoice = options.toolChoice;
    }

    let responseFormat: ResponseFormat | undefined;
    if (typeof options.responseFormat === "string") {
      responseFormat = create(ResponseFormatSchema, {
        formatType: formatTypeToProto(options.responseFormat),
      });
    } else {
      responseFormat = options.responseFormat;
    }

    let reasoningEffort: ReasoningEffort | undefined;
    if (typeof options.reasoningEffort === "string") {
      reasoningEffort = reasoningEffortToProto(options.reasoningEffort);
    } else {
      reasoningEffort = options.reasoningEffort;
    }

    let searchParameters: SearchParametersProto | undefined;
    if (options.searchParameters instanceof SearchParameters) {
      searchParameters = options.searchParameters.toProto();
    } else {
      searchParameters = options.searchParameters;
    }

    const include = options.include?.map(includeOptionToProto) ?? [];
    let agentCount: AgentCount | undefined;
    if (options.agentCount !== undefined) {
      agentCount = agentCountToProto(options.agentCount as 4 | 16 | AgentCount);
    }

    const serviceTier = serviceTierToProto(
      typeof options.serviceTier === "string" || options.serviceTier === undefined
        ? options.serviceTier
        : options.serviceTier,
    );

    return new Chat(this.stub, options.conversationId, options.batchRequestId, {
      model: options.model,
      messages: options.messages ? [...options.messages] : [],
      user: options.user ?? "",
      maxTokens: options.maxTokens,
      seed: options.seed,
      stop: options.stop ? [...options.stop] : [],
      temperature: options.temperature,
      topP: options.topP,
      logprobs: options.logprobs ?? false,
      topLogprobs: options.topLogprobs,
      tools: options.tools ? [...options.tools] : [],
      toolChoice,
      parallelToolCalls: options.parallelToolCalls,
      responseFormat,
      frequencyPenalty: options.frequencyPenalty,
      presencePenalty: options.presencePenalty,
      reasoningEffort,
      searchParameters,
      storeMessages: options.storeMessages ?? false,
      previousResponseId: options.previousResponseId,
      useEncryptedContent: options.useEncryptedContent ?? false,
      maxTurns: options.maxTurns,
      include,
      agentCount,
      serviceTier: serviceTier ?? (0 as ServiceTierEnum),
    });
  }

  async getStoredCompletion(responseId: string): Promise<Response[]> {
    const response = await this.stub.getStoredCompletion(
      create(GetStoredCompletionRequestSchema, { responseId }),
    );
    return Array.from({ length: response.outputs.length }, (_, i) => new Response(response, i));
  }

  async deleteStoredCompletion(responseId: string): Promise<string> {
    const response = await this.stub.deleteStoredCompletion(
      create(DeleteStoredCompletionRequestSchema, { responseId }),
    );
    return response.responseId;
  }

  async compactContext(model: string, messages: Message[]): Promise<CompactContextResponse> {
    const response = await this.stub.compactContext(
      create(CompactContextRequestSchema, { model, input: messages }),
    );
    return new CompactContextResponse(response);
  }
}
