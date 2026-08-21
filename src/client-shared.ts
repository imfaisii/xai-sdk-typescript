import { createClient, type Transport } from "@connectrpc/connect";
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
import type { ClientOptions, ResolvedClientConfig } from "./transport-shared.js";
import { VideoClient } from "./video.js";

/** The transport-creating functions a runtime (Node, web) supplies to build a `Client`. */
export interface TransportFns {
  resolveConfig: (options?: ClientOptions) => ResolvedClientConfig;
  createApiTransport: (config: ResolvedClientConfig, apiKey: string) => Transport;
  createManagementTransport: (config: ResolvedClientConfig) => Transport | undefined;
}

/**
 * Build the `Client` class for a given runtime, wired to that runtime's
 * transport-creating functions (Node gRPC vs. web gRPC-Web).
 */
export function createClientClass(fns: TransportFns) {
  return class Client {
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
      const config = fns.resolveConfig(options);
      const apiTransport = fns.createApiTransport(config, config.apiKey);
      const managementTransport = fns.createManagementTransport(config);

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
  };
}
