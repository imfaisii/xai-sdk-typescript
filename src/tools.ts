import { create } from "@bufbuild/protobuf";
import {
  CodeExecutionSchema,
  CollectionsSearchSchema,
  FunctionSchema,
  ImageGenerationSchema,
  MCPSchema,
  ToolCallType,
  ToolSchema,
  WebSearchSchema,
  WebSearchUserLocationSchema,
  XSearchSchema,
  type Tool,
  type ToolCall,
} from "./gen/xai/api/v1/chat_pb.js";
import {
  HybridRetrievalSchema,
  KeywordRetrievalSchema,
  SemanticRetrievalSchema,
  type HybridRetrieval,
  type KeywordRetrieval,
  type SemanticRetrieval,
} from "./gen/xai/api/v1/documents_pb.js";
import { dateToTimestamp } from "./util.js";

export type DocumentRetrievalMode = "hybrid" | "semantic" | "keyword";

export function webSearch(options?: {
  excludedDomains?: string[];
  allowedDomains?: string[];
  enableImageUnderstanding?: boolean;
  enableImageSearch?: boolean;
  userLocationCountry?: string;
  userLocationCity?: string;
  userLocationRegion?: string;
  userLocationTimezone?: string;
}): Tool {
  const hasLocation =
    options?.userLocationCountry !== undefined ||
    options?.userLocationCity !== undefined ||
    options?.userLocationRegion !== undefined ||
    options?.userLocationTimezone !== undefined;

  return create(ToolSchema, {
    tool: {
      case: "webSearch",
      value: create(WebSearchSchema, {
        excludedDomains: options?.excludedDomains ?? [],
        allowedDomains: options?.allowedDomains ?? [],
        enableImageUnderstanding: options?.enableImageUnderstanding,
        enableImageSearch: options?.enableImageSearch,
        userLocation: hasLocation
          ? create(WebSearchUserLocationSchema, {
              country: options?.userLocationCountry,
              city: options?.userLocationCity,
              region: options?.userLocationRegion,
              timezone: options?.userLocationTimezone,
            })
          : undefined,
      }),
    },
  });
}

export function xSearch(options?: {
  fromDate?: Date;
  toDate?: Date;
  allowedXHandles?: string[];
  excludedXHandles?: string[];
  enableImageUnderstanding?: boolean;
  enableVideoUnderstanding?: boolean;
}): Tool {
  return create(ToolSchema, {
    tool: {
      case: "xSearch",
      value: create(XSearchSchema, {
        fromDate: options?.fromDate ? dateToTimestamp(options.fromDate) : undefined,
        toDate: options?.toDate ? dateToTimestamp(options.toDate) : undefined,
        allowedXHandles: options?.allowedXHandles ?? [],
        excludedXHandles: options?.excludedXHandles ?? [],
        enableImageUnderstanding: options?.enableImageUnderstanding,
        enableVideoUnderstanding: options?.enableVideoUnderstanding,
      }),
    },
  });
}

export function codeExecution(): Tool {
  return create(ToolSchema, {
    tool: {
      case: "codeExecution",
      value: create(CodeExecutionSchema, {}),
    },
  });
}

export function imageGeneration(options?: { action?: "auto" | "generate" | "edit" }): Tool {
  return create(ToolSchema, {
    tool: {
      case: "imageGeneration",
      value: create(ImageGenerationSchema, {
        action: options?.action,
      }),
    },
  });
}

export function collectionsSearch(options: {
  collectionIds: string[];
  limit?: number;
  instructions?: string;
  retrievalMode?: DocumentRetrievalMode | HybridRetrieval | SemanticRetrieval | KeywordRetrieval;
}): Tool {
  let retrievalMode:
    | { case: "hybridRetrieval"; value: HybridRetrieval }
    | { case: "semanticRetrieval"; value: SemanticRetrieval }
    | { case: "keywordRetrieval"; value: KeywordRetrieval }
    | { case: undefined; value?: undefined } = { case: undefined };

  const mode = options.retrievalMode;
  if (mode === "hybrid") {
    retrievalMode = { case: "hybridRetrieval", value: create(HybridRetrievalSchema, {}) };
  } else if (mode === "semantic") {
    retrievalMode = { case: "semanticRetrieval", value: create(SemanticRetrievalSchema, {}) };
  } else if (mode === "keyword") {
    retrievalMode = { case: "keywordRetrieval", value: create(KeywordRetrievalSchema, {}) };
  } else if (mode && typeof mode === "object") {
    const t = (mode as { $typeName?: string }).$typeName ?? "";
    if (t.includes("SemanticRetrieval")) {
      retrievalMode = { case: "semanticRetrieval", value: mode as SemanticRetrieval };
    } else if (t.includes("KeywordRetrieval")) {
      retrievalMode = { case: "keywordRetrieval", value: mode as KeywordRetrieval };
    } else {
      retrievalMode = { case: "hybridRetrieval", value: mode as HybridRetrieval };
    }
  }

  return create(ToolSchema, {
    tool: {
      case: "collectionsSearch",
      value: create(CollectionsSearchSchema, {
        collectionIds: options.collectionIds,
        limit: options.limit,
        instructions: options.instructions,
        retrievalMode,
      }),
    },
  });
}

export function mcp(options: {
  serverUrl: string;
  serverLabel?: string;
  serverDescription?: string;
  allowedToolNames?: string[];
  authorization?: string;
  extraHeaders?: Record<string, string>;
}): Tool {
  return create(ToolSchema, {
    tool: {
      case: "mcp",
      value: create(MCPSchema, {
        serverUrl: options.serverUrl,
        serverLabel: options.serverLabel ?? "",
        serverDescription: options.serverDescription ?? "",
        allowedToolNames: options.allowedToolNames ?? [],
        authorization: options.authorization,
        extraHeaders: options.extraHeaders ?? {},
      }),
    },
  });
}

/** Client-side function tool definition. */
export function functionTool(name: string, description: string, parameters: Record<string, unknown>): Tool {
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

export function getToolCallType(toolCall: ToolCall): string {
  const name = ToolCallType[toolCall.type] ?? "TOOL_CALL_TYPE_INVALID";
  return name.replace(/^TOOL_CALL_TYPE_/, "").toLowerCase();
}
