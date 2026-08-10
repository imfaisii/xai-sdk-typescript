import { create } from "@bufbuild/protobuf";
import type { Client as ConnectClient } from "@connectrpc/connect";
import { Response } from "./chat.js";
import {
  AddBatchRequestsRequestSchema,
  BatchMgmt,
  BatchRequestSchema,
  CancelBatchRequestSchema,
  CreateBatchRequestSchema,
  GetBatchRequestResultRequestSchema,
  GetBatchRequestSchema,
  ListBatchRequestMetadataRequestSchema,
  ListBatchResultsRequestSchema,
  ListBatchesRequestSchema,
  type Batch,
  type BatchRequest,
  type BatchResult as BatchResultProto,
  type ListBatchRequestMetadataResponse,
  type ListBatchResultsResponse as ListBatchResultsResponseProto,
  type ListBatchesResponse,
} from "./gen/xai/api/v1/batch_pb.js";
import { ImageResponse } from "./image.js";
import { VideoResponse } from "./video.js";

type BatchRpc = ConnectClient<typeof BatchMgmt>;

/** A single batch request that can be added, or a Chat-like object with `.prepare()`. */
export type BatchAddable = BatchRequest | { prepare: (n?: number) => BatchRequest };

export class BatchResult {
  constructor(readonly proto: BatchResultProto) {}

  get batchRequestId(): string {
    return this.proto.batchRequestId;
  }

  get hasError(): boolean {
    return this.proto.result.case === "error";
  }

  get isSuccess(): boolean {
    return this.proto.result.case === "response";
  }

  get errorMessage(): string | undefined {
    if (this.proto.result.case === "error") {
      return this.proto.result.value.message || undefined;
    }
    return undefined;
  }

  get response(): Response {
    const data = this.proto.result.case === "response" ? this.proto.result.value : undefined;
    if (!data || data.response.case !== "completionResponse") {
      throw new Error("Batch result is not a chat completion response.");
    }
    return new Response(data.response.value, 0);
  }

  get imageResponse(): ImageResponse {
    const data = this.proto.result.case === "response" ? this.proto.result.value : undefined;
    if (!data || data.response.case !== "imageResponse") {
      throw new Error("Batch result is not an image response.");
    }
    return new ImageResponse(data.response.value, 0);
  }

  get videoResponse(): VideoResponse {
    const data = this.proto.result.case === "response" ? this.proto.result.value : undefined;
    if (!data || data.response.case !== "videoResponse") {
      throw new Error("Batch result is not a video response.");
    }
    return new VideoResponse(data.response.value);
  }
}

export class ListBatchResultsResponse {
  constructor(readonly proto: ListBatchResultsResponseProto) {}

  get results(): BatchResult[] {
    return this.proto.results.map((r) => new BatchResult(r));
  }

  get succeeded(): BatchResult[] {
    return this.results.filter((r) => r.isSuccess);
  }

  get failed(): BatchResult[] {
    return this.results.filter((r) => r.hasError);
  }

  get paginationToken(): string | undefined {
    return this.proto.paginationToken || undefined;
  }
}

function toBatchRequest(item: BatchAddable): BatchRequest {
  if (typeof item === "object" && item !== null && "prepare" in item && typeof item.prepare === "function") {
    return item.prepare();
  }
  // Assume BatchRequest proto (has request oneof)
  if (typeof item === "object" && item !== null && "request" in item) {
    return item as BatchRequest;
  }
  throw new Error(`Unsupported batch request type: ${typeof item}`);
}

export class BatchClient {
  constructor(private stub: BatchRpc) {}

  async create(batchName: string, options?: { inputFileId?: string }): Promise<Batch> {
    return this.stub.createBatch(
      create(CreateBatchRequestSchema, {
        name: batchName,
        inputFileId: options?.inputFileId ?? "",
      }),
    );
  }

  async add(batchId: string, batchRequests: BatchAddable[]): Promise<void> {
    const requests = batchRequests.map(toBatchRequest);
    await this.stub.addBatchRequests(
      create(AddBatchRequestsRequestSchema, {
        batchId,
        batchRequests: requests,
      }),
    );
  }

  async get(batchId: string): Promise<Batch> {
    return this.stub.getBatch(create(GetBatchRequestSchema, { batchId }));
  }

  async cancel(batchId: string): Promise<Batch> {
    return this.stub.cancelBatch(create(CancelBatchRequestSchema, { batchId }));
  }

  async list(options?: { limit?: number; paginationToken?: string }): Promise<ListBatchesResponse> {
    return this.stub.listBatches(
      create(ListBatchesRequestSchema, {
        limit: options?.limit,
        paginationToken: options?.paginationToken,
      }),
    );
  }

  async listBatchRequests(
    batchId: string,
    options?: { limit?: number; paginationToken?: string },
  ): Promise<ListBatchRequestMetadataResponse> {
    return this.stub.listBatchRequestMetadata(
      create(ListBatchRequestMetadataRequestSchema, {
        batchId,
        limit: options?.limit,
        paginationToken: options?.paginationToken,
      }),
    );
  }

  async listBatchResults(
    batchId: string,
    options?: { limit?: number; paginationToken?: string },
  ): Promise<ListBatchResultsResponse> {
    const proto = await this.stub.listBatchResults(
      create(ListBatchResultsRequestSchema, {
        batchId,
        limit: options?.limit,
        paginationToken: options?.paginationToken,
      }),
    );
    return new ListBatchResultsResponse(proto);
  }

  async getBatchRequestResult(batchId: string, batchRequestId: string) {
    return this.stub.getBatchRequestResult(
      create(GetBatchRequestResultRequestSchema, { batchId, batchRequestId }),
    );
  }
}

// re-export for callers constructing BatchRequest manually
export { BatchRequestSchema };
export type { Batch, BatchRequest };
