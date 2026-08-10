import type { Interceptor, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { VERSION } from "./version.js";

const DEFAULT_RPC_TIMEOUT_MS = 27 * 60 * 1000;

export interface ClientOptions {
  /** API key. Defaults to process.env.XAI_API_KEY. */
  apiKey?: string;
  /** Management API key for collections. Defaults to process.env.XAI_MANAGEMENT_KEY. */
  managementApiKey?: string;
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
  const apiKey = options.apiKey ?? process.env.XAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Trying to read the xAI API key from the XAI_API_KEY environment variable but it doesn't exist.",
    );
  }
  if (!apiKey.trim()) {
    throw new Error("Empty xAI API key provided.");
  }

  const managementApiKey = options.managementApiKey ?? process.env.XAI_MANAGEMENT_KEY;

  return {
    apiKey,
    managementApiKey: managementApiKey || undefined,
    apiHost: options.apiHost ?? "api.x.ai",
    managementApiHost: options.managementApiHost ?? "management-api.x.ai",
    metadata: {
      "xai-sdk-version": `js/${VERSION}`,
      "xai-sdk-language": `js/${process.version}`,
      ...(options.metadata ?? {}),
    },
    timeoutMs: options.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS,
    useInsecureChannel: options.useInsecureChannel ?? false,
  };
}

function authInterceptor(apiKey: string, metadata: Record<string, string>): Interceptor {
  return (next) => async (req) => {
    req.header.set("Authorization", `Bearer ${apiKey}`);
    for (const [k, v] of Object.entries(metadata)) {
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
