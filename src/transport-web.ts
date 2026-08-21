import type { Transport } from "@connectrpc/connect";
import { createGrpcWebTransport } from "@connectrpc/connect-web";
import {
  authInterceptor,
  DEFAULT_RPC_TIMEOUT_MS,
  resolveHostUrl,
  type ClientOptions,
  type ResolvedClientConfig,
} from "./transport-shared.js";
import { USER_AGENT, VERSION } from "./version.js";

export { authInterceptor, DEFAULT_RPC_TIMEOUT_MS, type ClientOptions, type ResolvedClientConfig };

/** `process.env`, when available (e.g. Workers with `nodejs_compat`). Not all fetch runtimes expose it. */
function processEnv(): Record<string, string | undefined> | undefined {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
}

function resolveSecret(optionValue: string | undefined, envName: string): string | undefined {
  if (optionValue !== undefined) return optionValue;
  const fromEnv = processEnv()?.[envName];
  return fromEnv && fromEnv !== "" ? fromEnv : undefined;
}

export function resolveConfig(options: ClientOptions = {}): ResolvedClientConfig {
  const apiKey = resolveSecret(options.apiKey, "XAI_API_KEY");
  if (!apiKey) {
    throw new Error(
      "xAI API key not found. Pass apiKey explicitly, or bind XAI_API_KEY as a Worker secret / environment variable.",
    );
  }
  if (!apiKey.trim()) {
    throw new Error("Empty xAI API key provided.");
  }

  const managementApiKey = resolveSecret(options.managementApiKey, "XAI_MANAGEMENT_KEY");

  return {
    apiKey,
    managementApiKey: managementApiKey || undefined,
    apiHost: options.apiHost ?? "api.x.ai",
    managementApiHost: options.managementApiHost ?? "management-api.x.ai",
    metadata: {
      "user-agent": USER_AGENT,
      "xai-sdk-version": `js/${VERSION}`,
      "xai-sdk-language": "js/web",
      ...(options.metadata ?? {}),
    },
    timeoutMs: options.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS,
    useInsecureChannel: options.useInsecureChannel ?? false,
  };
}

export function createApiTransport(config: ResolvedClientConfig, apiKey: string): Transport {
  return createGrpcWebTransport({
    baseUrl: resolveHostUrl(config.apiHost, config.useInsecureChannel),
    interceptors: [authInterceptor(apiKey, config.metadata)],
    defaultTimeoutMs: config.timeoutMs,
  });
}

export function createManagementTransport(config: ResolvedClientConfig): Transport | undefined {
  if (!config.managementApiKey) return undefined;
  return createGrpcWebTransport({
    baseUrl: resolveHostUrl(config.managementApiHost, config.useInsecureChannel),
    interceptors: [authInterceptor(config.managementApiKey, config.metadata)],
    defaultTimeoutMs: config.timeoutMs,
  });
}
