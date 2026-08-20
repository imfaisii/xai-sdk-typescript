import { create } from "@bufbuild/protobuf";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { Client as ConnectClient } from "@connectrpc/connect";
import {
  CreatePublicUrlRequestSchema,
  DeleteFileRequestSchema,
  Files,
  FilesSortBy,
  ListFilesRequestSchema,
  Ordering,
  RetrieveFileContentRequestSchema,
  RetrieveFileRequestSchema,
  RevokePublicUrlRequestSchema,
  UploadFileChunkSchema,
  UploadFileInitSchema,
  type CreatePublicUrlResponse,
  type DeleteFileResponse,
  type File,
  type ListFilesResponse,
  type RevokePublicUrlResponse,
} from "./gen/xai/api/v1/files_pb.js";

type FilesRpc = ConnectClient<typeof Files>;

export type FileOrder = "asc" | "desc";
export type FileSortBy = "created_at" | "filename" | "size";

const CHUNK_SIZE = 3 * 1024 * 1024;

function orderToPb(order: FileOrder): Ordering {
  return order === "asc" ? Ordering.ASCENDING : Ordering.DESCENDING;
}

function sortByToPb(sortBy: FileSortBy): FilesSortBy {
  switch (sortBy) {
    case "created_at":
      return FilesSortBy.CREATED_AT;
    case "filename":
      return FilesSortBy.FILENAME;
    case "size":
      return FilesSortBy.SIZE;
    default:
      throw new Error(`Invalid sort_by: ${sortBy}`);
  }
}

function expiresAfterToSeconds(expiresAfter?: number | Date | { seconds?: number }): bigint | undefined {
  if (expiresAfter === undefined) return undefined;
  if (typeof expiresAfter === "number") return BigInt(expiresAfter);
  if (expiresAfter instanceof Date) {
    return BigInt(Math.max(0, Math.floor((expiresAfter.getTime() - Date.now()) / 1000)));
  }
  if (typeof expiresAfter === "object" && typeof expiresAfter.seconds === "number") {
    return BigInt(expiresAfter.seconds);
  }
  return undefined;
}

export type ProgressCallback =
  | ((uploaded: number, total: number) => void)
  | ((chunkSize: number) => void)
  | { update: (n: number) => void };

function notifyProgress(progress: ProgressCallback | undefined, chunkSize: number, uploaded: number, total: number) {
  if (!progress) return;
  if (typeof progress === "object" && progress !== null && "update" in progress) {
    progress.update(chunkSize);
    return;
  }
  if (typeof progress === "function") {
    if (progress.length >= 2) {
      (progress as (u: number, t: number) => void)(uploaded, total);
    } else {
      (progress as (n: number) => void)(chunkSize);
    }
  }
}

async function* chunkBytes(
  filename: string,
  data: Uint8Array,
  expiresAfter?: bigint,
  progress?: ProgressCallback,
): AsyncGenerator<ReturnType<typeof create<typeof UploadFileChunkSchema>>> {
  yield create(UploadFileChunkSchema, {
    chunk: {
      case: "init",
      value: create(UploadFileInitSchema, {
        name: filename,
        expiresAfter,
      }),
    },
  });
  let offset = 0;
  while (offset < data.byteLength) {
    const end = Math.min(offset + CHUNK_SIZE, data.byteLength);
    const slice = data.subarray(offset, end);
    offset = end;
    notifyProgress(progress, slice.byteLength, offset, data.byteLength);
    yield create(UploadFileChunkSchema, {
      chunk: { case: "data", value: slice },
    });
  }
}

export class FilesClient {
  constructor(private stub: FilesRpc) {}

  async upload(
    file: string | Uint8Array | ArrayBuffer | { read: () => Uint8Array | Promise<Uint8Array>; name?: string },
    options?: {
      filename?: string;
      onProgress?: ProgressCallback;
      expiresAfter?: number | Date;
    },
  ): Promise<File> {
    let filename = options?.filename;
    let data: Uint8Array;

    if (typeof file === "string") {
      data = new Uint8Array(await readFile(file));
      filename = filename ?? basename(file);
    } else if (file instanceof Uint8Array) {
      data = file;
      if (!filename) throw new Error("filename is required when uploading bytes");
    } else if (file instanceof ArrayBuffer) {
      data = new Uint8Array(file);
      if (!filename) throw new Error("filename is required when uploading bytes");
    } else if (file && typeof file === "object" && "read" in file) {
      const buf = await file.read();
      data = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
      filename = filename ?? (typeof file.name === "string" ? basename(file.name) : undefined);
      if (!filename) throw new Error("filename is required when uploading a file-like object without a name");
    } else {
      throw new Error(`Unsupported file type: ${typeof file}`);
    }

    const expiresAfter = expiresAfterToSeconds(options?.expiresAfter);
    const chunks = chunkBytes(filename, data, expiresAfter, options?.onProgress);
    return this.stub.uploadFile(chunks);
  }

  async batchUpload(
    files: Array<string | { read: () => Uint8Array | Promise<Uint8Array>; name?: string }>,
    options?: {
      batchSize?: number;
      onFileComplete?: (index: number, file: unknown, result: File | Error) => void;
    },
  ): Promise<Record<number, File | Error>> {
    if (!files.length) throw new Error("files cannot be empty - please provide at least one file to upload");
    const batchSize = options?.batchSize ?? 50;
    const results: Record<number, File | Error> = {};
    let next = 0;

    async function worker(this: FilesClient) {
      while (true) {
        const i = next++;
        if (i >= files.length) return;
        const f = files[i]!;
        try {
          const res = await this.upload(f);
          results[i] = res;
          options?.onFileComplete?.(i, f, res);
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          results[i] = err;
          options?.onFileComplete?.(i, f, err);
        }
      }
    }

    const workers = Array.from({ length: Math.min(batchSize, files.length) }, () => worker.call(this));
    await Promise.all(workers);
    return results;
  }

  async list(options?: {
    limit?: number;
    order?: FileOrder;
    sortBy?: FileSortBy;
    paginationToken?: string;
    filter?: string;
  }): Promise<ListFilesResponse> {
    return this.stub.listFiles(
      create(ListFilesRequestSchema, {
        limit: options?.limit,
        order: options?.order ? orderToPb(options.order) : undefined,
        sortBy: options?.sortBy ? sortByToPb(options.sortBy) : undefined,
        paginationToken: options?.paginationToken,
        filter: options?.filter,
      }),
    );
  }

  async get(fileId: string): Promise<File> {
    return this.stub.retrieveFile(create(RetrieveFileRequestSchema, { fileId }));
  }

  async delete(fileId: string): Promise<DeleteFileResponse> {
    return this.stub.deleteFile(create(DeleteFileRequestSchema, { fileId }));
  }

  async content(fileId: string): Promise<Uint8Array> {
    const stream = this.stub.retrieveFileContent(create(RetrieveFileContentRequestSchema, { fileId }));
    const parts: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of stream) {
      parts.push(chunk.data);
      total += chunk.data.byteLength;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const p of parts) {
      out.set(p, offset);
      offset += p.byteLength;
    }
    return out;
  }

  async createPublicUrl(
    fileId: string,
    options?: { expiresAfter?: number | Date },
  ): Promise<CreatePublicUrlResponse> {
    return this.stub.createPublicUrl(
      create(CreatePublicUrlRequestSchema, {
        fileId,
        expiresAfter: expiresAfterToSeconds(options?.expiresAfter),
      }),
    );
  }

  async revokePublicUrl(fileId: string): Promise<RevokePublicUrlResponse> {
    return this.stub.revokePublicUrl(create(RevokePublicUrlRequestSchema, { fileId }));
  }
}
