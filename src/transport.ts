import type { Interceptor, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { resolveSecret } from "./env.js";
import { USER_AGENT, VERSION } from "./version.js";

const DEFAULT_RPC_TIMEOUT_MS = 27 * 60 * 1000;

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

export function resolveConfig(options: ClientOptions = {}): ResolvedClientConfig {
  const envOpts = { envDir: options.envDir };
  const apiKey = resolveSecret(options.apiKey, "XAI_API_KEY", envOpts);
  if (!apiKey) {
    throw new Error(
      "xAI API key not found. Set apiKey, export XAI_API_KEY, or add it to a .env file (.env, .env.local, .env.production, …).",
    );
  }
  if (!apiKey.trim()) {
    throw new Error("Empty xAI API key provided.");
  }

  const managementApiKey = resolveSecret(options.managementApiKey, "XAI_MANAGEMENT_KEY", envOpts);

  return {
    apiKey,
    managementApiKey: managementApiKey || undefined,
    apiHost: options.apiHost ?? "api.x.ai",
    managementApiHost: options.managementApiHost ?? "management-api.x.ai",
    metadata: {
      "user-agent": USER_AGENT,
      "xai-sdk-version": `js/${VERSION}`,
      "xai-sdk-language": `js/${process.version}`,
      ...(options.metadata ?? {}),
    },
    timeoutMs: options.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS,
    useInsecureChannel: options.useInsecureChannel ?? false,
  };
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

export function createApiTransport(config: ResolvedClientConfig, apiKey: string): Transport {
  const scheme = config.useInsecureChannel ? "http" : "https";
  const host = config.apiHost.includes("://") ? config.apiHost : `${scheme}://${config.apiHost}`;
  return createGrpcTransport({
    baseUrl: host,
    interceptors: [authInterceptor(apiKey, config.metadata)],
    defaultTimeoutMs: config.timeoutMs,
  });
}

export function createManagementTransport(config: ResolvedClientConfig): Transport | undefined {
  if (!config.managementApiKey) return undefined;
  const scheme = config.useInsecureChannel ? "http" : "https";
  const host = config.managementApiHost.includes("://")
    ? config.managementApiHost
    : `${scheme}://${config.managementApiHost}`;
  return createGrpcTransport({
    baseUrl: host,
    interceptors: [authInterceptor(config.managementApiKey, config.metadata)],
    defaultTimeoutMs: config.timeoutMs,
  });
}
