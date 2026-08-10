import type { SamplingUsage } from "./gen/xai/api/v1/usage_pb.js";

/** Cost helpers. 1 USD = 10_000_000_000 ticks (10 billion). */
export const TICKS_PER_USD = 10_000_000_000;

export function costUsdFromTicks(ticks: bigint | number | undefined | null): number | undefined {
  if (ticks === undefined || ticks === null) return undefined;
  const n = typeof ticks === "bigint" ? Number(ticks) : ticks;
  return n / TICKS_PER_USD;
}

/** Cost of a single request in USD from SamplingUsage, or undefined if not reported. */
export function costUsdFromUsage(usage: SamplingUsage | undefined | null): number | undefined {
  if (!usage || usage.costInUsdTicks === undefined) return undefined;
  return costUsdFromTicks(usage.costInUsdTicks);
}
