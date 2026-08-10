import { createClient } from "@connectrpc/connect";
import { Auth } from "./gen/xai/api/v1/auth_pb.js";
import { BatchMgmt } from "./gen/xai/api/v1/batch_pb.js";
import { Chat as ChatService } from "./gen/xai/api/v1/chat_pb.js";
import { Files } from "./gen/xai/api/v1/files_pb.js";
import { Image } from "./gen/xai/api/v1/image_pb.js";
import { Models } from "./gen/xai/api/v1/models_pb.js";
import { Tokenize } from "./gen/xai/api/v1/tokenize_pb.js";
import { Video } from "./gen/xai/api/v1/video_pb.js";
import { AuthClient } from "./auth.js";
import { BatchClient } from "./batch.js";
import { ChatClient } from "./chat.js";
import { CollectionsClient } from "./collections.js";
import { FilesClient } from "./files.js";
import { ImageClient } from "./image.js";
import { ModelsClient } from "./models.js";
import { TokenizerClient } from "./tokenizer.js";
import {
  createApiTransport,
  createManagementTransport,
  resolveConfig,
  type ClientOptions,
} from "./transport.js";
import { VideoClient } from "./video.js";

/**
 * Async client for the xAI API (gRPC).
 *
 * ```ts
 * import { Client } from "xai-sdk-js";
 *
 * const client = new Client(); // uses XAI_API_KEY
 * const chat = client.chat.create({ model: "grok-4" });
 * ```
 */
export class Client {
  readonly auth: AuthClient;
  readonly batch: BatchClient;
  readonly chat: ChatClient;
  readonly collections: CollectionsClient;
  readonly files: FilesClient;
  readonly image: ImageClient;
  readonly models: ModelsClient;
  readonly tokenize: TokenizerClient;
  readonly video: VideoClient;

  constructor(options: ClientOptions = {}) {
    const config = resolveConfig(options);
    const apiTransport = createApiTransport(config, config.apiKey);
    const managementTransport = createManagementTransport(config);

    this.auth = new AuthClient(createClient(Auth, apiTransport));
    this.batch = new BatchClient(createClient(BatchMgmt, apiTransport));
    this.chat = new ChatClient(createClient(ChatService, apiTransport));
    this.collections = new CollectionsClient(apiTransport, managementTransport);
    this.files = new FilesClient(createClient(Files, apiTransport));
    this.image = new ImageClient(createClient(Image, apiTransport));
    this.models = new ModelsClient(createClient(Models, apiTransport));
    this.tokenize = new TokenizerClient(createClient(Tokenize, apiTransport));
    this.video = new VideoClient(createClient(Video, apiTransport));
  }
}

export type { ClientOptions };
