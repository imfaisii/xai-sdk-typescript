import { create } from "@bufbuild/protobuf";
import type { Client as ConnectClient, Transport } from "@connectrpc/connect";
import { createClient } from "@connectrpc/connect";
import {
  AddDocumentToCollectionRequestSchema,
  BatchGetDocumentsRequestSchema,
  Collections,
  CollectionsSortBy,
  CreateCollectionRequestSchema,
  DeleteCollectionRequestSchema,
  DocumentStatus,
  DocumentsSortBy,
  FieldDefinitionOperation,
  FieldDefinitionSchema,
  FieldDefinitionUpdateSchema,
  GenerateCollectionDescriptionRequestSchema,
  GetCollectionMetadataRequestSchema,
  GetDocumentMetadataRequestSchema,
  ListCollectionsRequestSchema,
  ListDocumentsRequestSchema,
  ReIndexDocumentRequestSchema,
  RemoveDocumentFromCollectionRequestSchema,
  UpdateCollectionRequestSchema,
  UpdateDocumentRequestSchema,
  type CollectionMetadata,
  type DocumentMetadata,
  type FieldDefinition as FieldDefinitionProto,
  type FieldDefinitionUpdate as FieldDefinitionUpdateProto,
  type ListCollectionsResponse,
  type ListDocumentsResponse,
  type BatchGetDocumentsResponse,
} from "./gen/xai/api/v1/collections_pb.js";
import {
  Documents,
  DocumentsSourceSchema,
  HybridRetrievalSchema,
  KeywordRetrievalSchema,
  SearchRequestSchema,
  SemanticRetrievalSchema,
  type SearchResponse,
} from "./gen/xai/api/v1/documents_pb.js";
import { Files } from "./gen/xai/api/v1/files_pb.js";
import { Ordering } from "./gen/xai/api/v1/shared_pb.js";
import {
  BytesConfigurationSchema,
  CharsConfigurationSchema,
  ChunkConfigurationSchema,
  HNSWMetric,
  IndexConfigurationSchema,
  TokensConfigurationSchema,
  type ChunkConfiguration as ChunkConfigurationProto,
} from "./gen/xai/api/v1/types_pb.js";
import { FilesClient } from "./files.js";
import { PollTimer } from "./util.js";

type CollectionsRpc = ConnectClient<typeof Collections>;
type DocumentsRpc = ConnectClient<typeof Documents>;

export type OrderName = "asc" | "desc";
export type CollectionSortByName = "name" | "age";
export type DocumentSortByName = "name" | "size" | "age";
export type HNSWMetricName = "cosine" | "euclidean" | "inner_product";
export type DocumentRetrievalMode = "hybrid" | "semantic" | "keyword";

export interface FieldDefinitionInput {
  key: string;
  required?: boolean;
  injectIntoChunk?: boolean;
  unique?: boolean;
  description?: string;
}

export type FieldDefinitionUpdateInput =
  | { operation: "add"; fieldDefinition: FieldDefinitionInput }
  | { operation: "delete"; key: string };

export interface ChunkConfigurationInput {
  stripWhitespace?: boolean;
  injectNameIntoChunks?: boolean;
  charsConfiguration?: { maxChunkSizeChars?: number; chunkOverlapChars?: number };
  tokensConfiguration?: {
    maxChunkSizeTokens?: number;
    chunkOverlapTokens?: number;
    encodingName?: string;
  };
  bytesConfiguration?: { maxChunkSizeBytes?: number; chunkOverlapBytes?: number };
}

const DEFAULT_INDEXING_POLL_MS = 10_000;
const DEFAULT_INDEXING_TIMEOUT_MS = 2 * 60 * 1000;

function orderToPb(order?: OrderName): Ordering | undefined {
  if (!order) return undefined;
  return order === "asc" ? Ordering.ASCENDING : Ordering.DESCENDING;
}

function collectionSortByToPb(sortBy?: CollectionSortByName): CollectionsSortBy | undefined {
  if (!sortBy) return undefined;
  if (sortBy === "name") return CollectionsSortBy.NAME;
  if (sortBy === "age") return CollectionsSortBy.AGE;
  throw new Error(`Invalid collection sort_by: ${sortBy}`);
}

function documentSortByToPb(sortBy?: DocumentSortByName): DocumentsSortBy | undefined {
  if (!sortBy) return undefined;
  if (sortBy === "name") return DocumentsSortBy.NAME;
  if (sortBy === "size") return DocumentsSortBy.SIZE;
  if (sortBy === "age") return DocumentsSortBy.AGE;
  throw new Error(`Invalid document sort_by: ${sortBy}`);
}

function hnswMetricToPb(metric?: HNSWMetricName): HNSWMetric | undefined {
  if (!metric) return undefined;
  switch (metric) {
    case "cosine":
      return HNSWMetric.HNSW_METRIC_COSINE;
    case "euclidean":
      return HNSWMetric.HNSW_METRIC_EUCLIDEAN;
    case "inner_product":
      return HNSWMetric.HNSW_METRIC_INNER_PRODUCT;
    default:
      throw new Error(`Invalid HNSW metric: ${metric}`);
  }
}

function fieldDefinitionToPb(fd: FieldDefinitionInput): FieldDefinitionProto {
  return create(FieldDefinitionSchema, {
    key: fd.key,
    required: fd.required ?? false,
    injectIntoChunk: fd.injectIntoChunk ?? false,
    unique: fd.unique ?? false,
    description: fd.description ?? "",
  });
}

function fieldDefinitionUpdateToPb(update: FieldDefinitionUpdateInput): FieldDefinitionUpdateProto {
  if (update.operation === "add") {
    return create(FieldDefinitionUpdateSchema, {
      fieldDefinition: fieldDefinitionToPb(update.fieldDefinition),
      operation: FieldDefinitionOperation.FIELD_DEFINITION_ADD,
    });
  }
  return create(FieldDefinitionUpdateSchema, {
    fieldDefinition: create(FieldDefinitionSchema, { key: update.key }),
    operation: FieldDefinitionOperation.FIELD_DEFINITION_DELETE,
  });
}

function chunkConfigurationToPb(input?: ChunkConfigurationInput | ChunkConfigurationProto): ChunkConfigurationProto | undefined {
  if (!input) return undefined;
  // Already a proto message (has $typeName or nested schema shapes with stripWhitespace as bool set)
  if ("$typeName" in (input as object)) {
    return input as ChunkConfigurationProto;
  }
  const cfg = input as ChunkConfigurationInput;
  return create(ChunkConfigurationSchema, {
    stripWhitespace: cfg.stripWhitespace ?? false,
    injectNameIntoChunks: cfg.injectNameIntoChunks ?? false,
    charsConfiguration: cfg.charsConfiguration
      ? create(CharsConfigurationSchema, {
          maxChunkSizeChars: cfg.charsConfiguration.maxChunkSizeChars ?? 0,
          chunkOverlapChars: cfg.charsConfiguration.chunkOverlapChars ?? 0,
        })
      : undefined,
    tokensConfiguration: cfg.tokensConfiguration
      ? create(TokensConfigurationSchema, {
          maxChunkSizeTokens: cfg.tokensConfiguration.maxChunkSizeTokens ?? 0,
          chunkOverlapTokens: cfg.tokensConfiguration.chunkOverlapTokens ?? 0,
          encodingName: cfg.tokensConfiguration.encodingName ?? "",
        })
      : undefined,
    bytesConfiguration: cfg.bytesConfiguration
      ? create(BytesConfigurationSchema, {
          maxChunkSizeBytes: cfg.bytesConfiguration.maxChunkSizeBytes ?? 0,
          chunkOverlapBytes: cfg.bytesConfiguration.chunkOverlapBytes ?? 0,
        })
      : undefined,
  });
}

export class CollectionsClient {
  private documentsStub: DocumentsRpc;
  private files: FilesClient;
  private managementTransport: Transport | undefined;
  private collectionsStubCache: CollectionsRpc | undefined;

  constructor(apiTransport: Transport, managementTransport?: Transport) {
    this.documentsStub = createClient(Documents, apiTransport);
    this.files = new FilesClient(createClient(Files, apiTransport));
    this.managementTransport = managementTransport;
  }

  private get collectionsStub(): CollectionsRpc {
    if (!this.managementTransport) {
      throw new Error("Please provide a management API key (managementApiKey / XAI_MANAGEMENT_KEY).");
    }
    if (!this.collectionsStubCache) {
      this.collectionsStubCache = createClient(Collections, this.managementTransport);
    }
    return this.collectionsStubCache;
  }

  async create(
    name: string,
    options?: {
      modelName?: string;
      chunkConfiguration?: ChunkConfigurationInput | ChunkConfigurationProto;
      metricSpace?: HNSWMetricName | HNSWMetric;
      fieldDefinitions?: FieldDefinitionInput[] | FieldDefinitionProto[];
      description?: string;
    },
  ): Promise<CollectionMetadata> {
    const metricSpace =
      typeof options?.metricSpace === "string"
        ? hnswMetricToPb(options.metricSpace)
        : options?.metricSpace;

    const fieldDefinitions = (options?.fieldDefinitions ?? []).map((fd) => {
      if (fd && typeof fd === "object" && "$typeName" in fd) return fd as FieldDefinitionProto;
      return fieldDefinitionToPb(fd as FieldDefinitionInput);
    });

    return this.collectionsStub.createCollection(
      create(CreateCollectionRequestSchema, {
        collectionName: name,
        indexConfiguration: options?.modelName
          ? create(IndexConfigurationSchema, { modelName: options.modelName })
          : undefined,
        chunkConfiguration: chunkConfigurationToPb(options?.chunkConfiguration),
        metricSpace: metricSpace ?? HNSWMetric.HNSW_METRIC_UNKNOWN,
        fieldDefinitions,
        collectionDescription: options?.description ?? "",
      }),
    );
  }

  async list(options?: {
    limit?: number;
    order?: OrderName;
    sortBy?: CollectionSortByName;
    filter?: string;
    paginationToken?: string;
  }): Promise<ListCollectionsResponse> {
    return this.collectionsStub.listCollections(
      create(ListCollectionsRequestSchema, {
        limit: options?.limit,
        order: orderToPb(options?.order),
        sortBy: collectionSortByToPb(options?.sortBy),
        filter: options?.filter ?? "",
        paginationToken: options?.paginationToken ?? "",
      }),
    );
  }

  async get(collectionId: string): Promise<CollectionMetadata> {
    return this.collectionsStub.getCollectionMetadata(
      create(GetCollectionMetadataRequestSchema, { collectionId }),
    );
  }

  async update(
    collectionId: string,
    options: {
      name?: string;
      chunkConfiguration?: ChunkConfigurationInput | ChunkConfigurationProto;
      fieldDefinitions?: FieldDefinitionUpdateInput[];
      description?: string;
    },
  ): Promise<CollectionMetadata> {
    if (
      options.name === undefined &&
      options.chunkConfiguration === undefined &&
      options.fieldDefinitions === undefined &&
      options.description === undefined
    ) {
      throw new Error(
        "At least one of name, chunkConfiguration, fieldDefinitions, or description must be provided to update a collection",
      );
    }
    return this.collectionsStub.updateCollection(
      create(UpdateCollectionRequestSchema, {
        collectionId,
        collectionName: options.name,
        chunkConfiguration: chunkConfigurationToPb(options.chunkConfiguration),
        fieldDefinitionUpdates: (options.fieldDefinitions ?? []).map(fieldDefinitionUpdateToPb),
        collectionDescription: options.description,
      }),
    );
  }

  async delete(collectionId: string): Promise<void> {
    await this.collectionsStub.deleteCollection(
      create(DeleteCollectionRequestSchema, { collectionId }),
    );
  }

  async search(
    query: string,
    collectionIds: string[],
    options?: {
      limit?: number;
      instructions?: string;
      retrievalMode?: DocumentRetrievalMode;
    },
  ): Promise<SearchResponse> {
    let retrievalMode:
      | { case: "hybridRetrieval"; value: ReturnType<typeof create<typeof HybridRetrievalSchema>> }
      | { case: "semanticRetrieval"; value: ReturnType<typeof create<typeof SemanticRetrievalSchema>> }
      | { case: "keywordRetrieval"; value: ReturnType<typeof create<typeof KeywordRetrievalSchema>> }
      | { case: undefined; value?: undefined } = { case: undefined };

    if (options?.retrievalMode === "hybrid") {
      retrievalMode = { case: "hybridRetrieval", value: create(HybridRetrievalSchema, {}) };
    } else if (options?.retrievalMode === "semantic") {
      retrievalMode = { case: "semanticRetrieval", value: create(SemanticRetrievalSchema, {}) };
    } else if (options?.retrievalMode === "keyword") {
      retrievalMode = { case: "keywordRetrieval", value: create(KeywordRetrievalSchema, {}) };
    }

    return this.documentsStub.search(
      create(SearchRequestSchema, {
        query,
        source: create(DocumentsSourceSchema, { collectionIds: [...collectionIds] }),
        limit: options?.limit,
        instructions: options?.instructions,
        retrievalMode,
      }),
    );
  }

  async uploadDocument(
    collectionId: string,
    name: string,
    data: Uint8Array | ArrayBuffer | string,
    options?: {
      fields?: Record<string, string>;
      waitForIndexing?: boolean;
      pollIntervalMs?: number;
      timeoutMs?: number;
    },
  ): Promise<DocumentMetadata> {
    let bytes: Uint8Array;
    if (typeof data === "string") {
      bytes = new TextEncoder().encode(data);
    } else if (data instanceof ArrayBuffer) {
      bytes = new Uint8Array(data);
    } else {
      bytes = data;
    }

    const uploaded = await this.files.upload(bytes, { filename: name });
    await this.collectionsStub.addDocumentToCollection(
      create(AddDocumentToCollectionRequestSchema, {
        collectionId,
        fileId: uploaded.id,
        fields: options?.fields ?? {},
      }),
    );

    if (options?.waitForIndexing) {
      return this.waitForIndexing(
        collectionId,
        uploaded.id,
        options.pollIntervalMs ?? DEFAULT_INDEXING_POLL_MS,
        options.timeoutMs ?? DEFAULT_INDEXING_TIMEOUT_MS,
      );
    }
    return this.getDocument(uploaded.id, collectionId);
  }

  private async waitForIndexing(
    collectionId: string,
    fileId: string,
    pollIntervalMs: number,
    timeoutMs: number,
  ): Promise<DocumentMetadata> {
    const timer = new PollTimer({ timeoutMs, intervalMs: pollIntervalMs, maxIntervalMs: pollIntervalMs });
    while (true) {
      const meta = await this.getDocument(fileId, collectionId);
      switch (meta.status) {
        case DocumentStatus.PROCESSED:
          return meta;
        case DocumentStatus.FAILED:
          throw new Error(`Document indexing failed: ${meta.errorMessage || "unknown error"}`);
        case DocumentStatus.PROCESSING:
        case DocumentStatus.CHUNKED:
        case DocumentStatus.EMBEDDING:
        case DocumentStatus.WRITING:
        default:
          await timer.waitOrThrow("waiting for document to be indexed");
      }
    }
  }

  async addExistingDocument(
    collectionId: string,
    fileId: string,
    options?: { fields?: Record<string, string> },
  ): Promise<void> {
    await this.collectionsStub.addDocumentToCollection(
      create(AddDocumentToCollectionRequestSchema, {
        collectionId,
        fileId,
        fields: options?.fields ?? {},
      }),
    );
  }

  async listDocuments(
    collectionId: string,
    options?: {
      limit?: number;
      order?: OrderName;
      sortBy?: DocumentSortByName;
      paginationToken?: string;
      filter?: string;
    },
  ): Promise<ListDocumentsResponse> {
    return this.collectionsStub.listDocuments(
      create(ListDocumentsRequestSchema, {
        collectionId,
        limit: options?.limit,
        order: orderToPb(options?.order),
        sortBy: documentSortByToPb(options?.sortBy),
        paginationToken: options?.paginationToken ?? "",
        filter: options?.filter ?? "",
      }),
    );
  }

  async getDocument(fileId: string, collectionId: string): Promise<DocumentMetadata> {
    return this.collectionsStub.getDocumentMetadata(
      create(GetDocumentMetadataRequestSchema, { fileId, collectionId }),
    );
  }

  async batchGetDocuments(collectionId: string, fileIds: string[]): Promise<BatchGetDocumentsResponse> {
    return this.collectionsStub.batchGetDocuments(
      create(BatchGetDocumentsRequestSchema, {
        collectionId,
        fileIds: [...fileIds],
      }),
    );
  }

  async removeDocument(collectionId: string, fileId: string): Promise<void> {
    await this.collectionsStub.removeDocumentFromCollection(
      create(RemoveDocumentFromCollectionRequestSchema, { collectionId, fileId }),
    );
  }

  async updateDocument(
    collectionId: string,
    fileId: string,
    options?: {
      name?: string;
      data?: Uint8Array;
      contentType?: string;
      fields?: Record<string, string>;
    },
  ): Promise<DocumentMetadata> {
    return this.collectionsStub.updateDocument(
      create(UpdateDocumentRequestSchema, {
        collectionId,
        fileId,
        name: options?.name,
        data: options?.data,
        contentType: options?.contentType,
        fields: options?.fields ?? {},
      }),
    );
  }

  async reindexDocument(collectionId: string, fileId: string): Promise<void> {
    await this.collectionsStub.reIndexDocument(
      create(ReIndexDocumentRequestSchema, { collectionId, fileId }),
    );
  }

  async generateDescription(collectionId: string): Promise<string> {
    const res = await this.collectionsStub.generateCollectionDescription(
      create(GenerateCollectionDescriptionRequestSchema, { collectionId }),
    );
    return res.collectionDescription;
  }
}
