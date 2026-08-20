import { ConnectError, Code } from "@connectrpc/connect";

/** Structured error for xAI API failures. */
export class XAIError extends Error {
  readonly code: Code | string;
  readonly details?: unknown;
  readonly raw?: unknown;

  constructor(message: string, options?: { code?: Code | string; details?: unknown; cause?: unknown; raw?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "XAIError";
    this.code = options?.code ?? "unknown";
    this.details = options?.details;
    this.raw = options?.raw;
  }

  static fromUnknown(err: unknown): XAIError {
    if (err instanceof XAIError) return err;
    if (err instanceof ConnectError) {
      return new XAIError(err.message, { code: err.code, details: err.details, cause: err, raw: err });
    }
    if (err instanceof Error) {
      return new XAIError(err.message, { cause: err, raw: err });
    }
    return new XAIError(String(err), { raw: err });
  }
}

/** Raised when the API reports that video generation or extension failed. */
export class VideoGenerationError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "VideoGenerationError";
    this.code = code;
  }
}

export { Code, ConnectError };
