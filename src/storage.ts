import { create } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  type FileOutput,
  PublicUrlOptionsSchema,
  type StorageOptions,
  StorageOptionsSchema,
} from "./gen/xai/api/v1/image_pb.js";

/**
 * Request a public URL for a stored file. `true` uses the default expiry;
 * an object sets an expiry independent of the file's own TTL.
 */
export type PublicUrlInput = boolean | { expiresAfter: number };

/** Options for persisting a generated image or video to the Files API. */
export interface StorageOptionsInput {
  /** Name to store the generated file under. */
  filename: string;
  /** Time-to-live in seconds, after which the file is deleted. */
  expiresAfter?: number;
  /** Create a publicly shareable URL for the stored file. */
  publicUrl?: PublicUrlInput;
}

export function storageOptionsToPb(options: StorageOptionsInput | undefined): StorageOptions | undefined {
  if (!options) return undefined;
  if (!options.filename) throw new Error("storageOptions.filename is required.");

  let publicUrl = undefined;
  if (options.publicUrl === true) {
    publicUrl = create(PublicUrlOptionsSchema, {});
  } else if (typeof options.publicUrl === "object") {
    publicUrl = create(PublicUrlOptionsSchema, { expiresAfter: BigInt(options.publicUrl.expiresAfter) });
  }

  return create(StorageOptionsSchema, {
    filename: options.filename,
    expiresAfter: options.expiresAfter === undefined ? undefined : BigInt(options.expiresAfter),
    publicUrl,
  });
}

/** Details of a generated asset that was persisted to the Files API. */
export interface FileOutputInfo {
  fileId: string;
  filename: string;
  publicUrl?: string;
  publicUrlExpiresAt?: Date;
  expiresAt?: Date;
  publicUrlError?: string;
}

export function fileOutputFromPb(output: FileOutput | undefined): FileOutputInfo | undefined {
  if (!output) return undefined;
  return {
    fileId: output.fileId,
    filename: output.filename,
    publicUrl: output.publicUrl,
    publicUrlExpiresAt: output.publicUrlExpiresAt ? timestampDate(output.publicUrlExpiresAt) : undefined,
    expiresAt: output.expiresAt ? timestampDate(output.expiresAt) : undefined,
    publicUrlError: output.publicUrlError,
  };
}
