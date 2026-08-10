import { create } from "@bufbuild/protobuf";
import { timestampFromDate, timestampDate } from "@bufbuild/protobuf/wkt";
import type { Timestamp } from "@bufbuild/protobuf/wkt";

export function dateToTimestamp(date: Date): Timestamp {
  return timestampFromDate(date);
}

export function timestampToDate(ts: Timestamp | undefined): Date | undefined {
  if (!ts) return undefined;
  return timestampDate(ts);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff poll timer matching the Python SDK PollTimer behavior. */
export class PollTimer {
  private readonly deadline: number;
  private readonly maxIntervalMs: number;
  private intervalMs: number;

  constructor(options?: { timeoutMs?: number; intervalMs?: number; maxIntervalMs?: number }) {
    const timeoutMs = options?.timeoutMs ?? 10 * 60 * 1000;
    this.deadline = Date.now() + timeoutMs;
    this.intervalMs = options?.intervalMs ?? 500;
    this.maxIntervalMs = options?.maxIntervalMs ?? 5000;
  }

  async waitOrThrow(errorMessage = "Polling timed out"): Promise<void> {
    if (Date.now() >= this.deadline) {
      throw new Error(errorMessage);
    }
    await sleep(this.intervalMs);
    this.intervalMs = Math.min(this.intervalMs * 1.5, this.maxIntervalMs);
    if (Date.now() >= this.deadline) {
      throw new Error(errorMessage);
    }
  }
}

export { create };
