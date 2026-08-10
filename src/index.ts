/** xAI TypeScript/JavaScript SDK (gRPC). */

export { Client } from "./client.js";
export type { ClientOptions } from "./transport.js";
export { loadEnvFiles, parseEnvFile } from "./env.js";
export { VERSION } from "./version.js";
export { XAIError, Code, ConnectError } from "./errors.js";
export { TICKS_PER_USD, costUsdFromTicks, costUsdFromUsage } from "./cost.js";
export { PollTimer } from "./util.js";

// Chat
export {
  Chat,
  ChatClient,
  Response,
  Chunk,
  CompactContextResponse,
  text,
  image,
  file,
  user,
  system,
  assistant,
  developer,
  toolResult,
  tool,
  requiredTool,
  type CreateChatOptions,
  type ContentInput,
  type ReasoningEffortName,
  type ToolModeName,
  type ResponseFormatName,
  type ImageDetailName,
  type IncludeOptionName,
} from "./chat.js";

// Tools & search
export {
  webSearch,
  xSearch,
  codeExecution,
  collectionsSearch,
  mcp,
  functionTool,
  getToolCallType,
  type DocumentRetrievalMode as ToolDocumentRetrievalMode,
} from "./tools.js";
export {
  SearchParameters,
  webSource,
  newsSource,
  xSource,
  rssSource,
} from "./search.js";
export { serviceTierToProto, serviceTierFromProto, type ServiceTierName } from "./service-tier.js";

// Resource clients
export { AuthClient } from "./auth.js";
export {
  BatchClient,
  BatchResult,
  ListBatchResultsResponse,
  BatchRequestSchema,
  type BatchAddable,
  type Batch,
  type BatchRequest,
} from "./batch.js";
export {
  ImageClient,
  ImageResponse,
  type ImageSampleOptions,
  type ImageFormatName,
  type ImageAspectRatioName,
  type ImageResolutionName,
} from "./image.js";
export {
  VideoClient,
  VideoResponse,
  type VideoGenerateOptions,
  type VideoAspectRatioName,
  type VideoResolutionName,
} from "./video.js";
export {
  FilesClient,
  type FileOrder,
  type FileSortBy,
  type ProgressCallback,
} from "./files.js";
export {
  CollectionsClient,
  type OrderName,
  type CollectionSortByName,
  type DocumentSortByName,
  type HNSWMetricName,
  type DocumentRetrievalMode,
  type FieldDefinitionInput,
  type FieldDefinitionUpdateInput,
  type ChunkConfigurationInput,
} from "./collections.js";
export { ModelsClient } from "./models.js";
export { TokenizerClient } from "./tokenizer.js";
