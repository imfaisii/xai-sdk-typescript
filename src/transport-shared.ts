import type { Interceptor } from "@connectrpc/connect";

export const DEFAULT_RPC_TIMEOUT_MS = 27 * 60 * 1000;

export interface ClientOptions {
  /**
   * API key. Resolution order:
   * 1. this option
   * 2. `process.env.XAI_API_KEY` (exported shell / host env)
   * 3. dotenv files in `envDir` (cwd by default): `.env`, `.env.<mode>`,
   *    `.env.local`, `.env.<mode>.local`, plus other `.env.*` variants
   *    (e.g. `.env.production`, `.env.staging`). Mode is `XAI_ENV` or `NODE_ENV`.
   */
  apiKey?: string;
  /**
   * Management API key for collections. Same resolution order as `apiKey`,
   * using `XAI_MANAGEMENT_KEY`.
   */
  managementApiKey?: string;
  /** Directory to scan for `.env*` files. Default: `process.cwd()`. */
  envDir?: string;
  /** API host. Default: api.x.ai */
  apiHost?: string;
  /** Management API host. Default: management-api.x.ai */
  managementApiHost?: string;
  /** Extra metadata headers sent on every request. */
  metadata?: Record<string, string>;
  /** Per-RPC timeout in milliseconds. Default: 27 minutes. */
  timeoutMs?: number;
  /** Use plain http (no TLS). For local testing only. */
  useInsecureChannel?: boolean;
}

export interface ResolvedClientConfig {
  apiKey: string;
  managementApiKey?: string;
  apiHost: string;
  managementApiHost: string;
  metadata: Record<string, string>;
  timeoutMs: number;
  useInsecureChannel: boolean;
}

export function authInterceptor(apiKey: string, metadata: Record<string, string>): Interceptor {
  return (next) => async (req) => {
    req.header.set("Authorization", `Bearer ${apiKey}`);
    for (const [k, v] of Object.entries(metadata)) {
      // Per-call headers (e.g. a Chat's x-grok-conv-id) win over client metadata,
      // so one client can serve many conversations without losing sticky routing.
      if (req.header.has(k)) continue;
      req.header.set(k, v);
    }
    return next(req);
  };
}

/** Build a base URL from a host string, adding the scheme if not already present. */
export function resolveHostUrl(host: string, useInsecureChannel: boolean): string {
  if (host.includes("://")) return host;
  const scheme = useInsecureChannel ? "http" : "https";
  return `${scheme}://${host}`;
}
