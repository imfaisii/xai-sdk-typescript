import { create } from "@bufbuild/protobuf";
import { EmptySchema } from "@bufbuild/protobuf/wkt";
import type { Client as ConnectClient } from "@connectrpc/connect";
import {
  GetModelRequestSchema,
  Models,
  type EmbeddingModel,
  type ImageGenerationModel,
  type LanguageModel,
} from "./gen/xai/api/v1/models_pb.js";

type ModelsRpc = ConnectClient<typeof Models>;

export class ModelsClient {
  constructor(private stub: ModelsRpc) {}

  async listLanguageModels(): Promise<LanguageModel[]> {
    const res = await this.stub.listLanguageModels(create(EmptySchema));
    return res.models;
  }

  async getLanguageModel(name: string): Promise<LanguageModel> {
    return this.stub.getLanguageModel(create(GetModelRequestSchema, { name }));
  }

  async listEmbeddingModels(): Promise<EmbeddingModel[]> {
    const res = await this.stub.listEmbeddingModels(create(EmptySchema));
    return res.models;
  }

  async getEmbeddingModel(name: string): Promise<EmbeddingModel> {
    return this.stub.getEmbeddingModel(create(GetModelRequestSchema, { name }));
  }

  async listImageGenerationModels(): Promise<ImageGenerationModel[]> {
    const res = await this.stub.listImageGenerationModels(create(EmptySchema));
    return res.models;
  }

  async getImageGenerationModel(name: string): Promise<ImageGenerationModel> {
    return this.stub.getImageGenerationModel(create(GetModelRequestSchema, { name }));
  }
}
