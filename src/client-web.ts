import { createClientClass } from "./client-shared.js";
import {
  createApiTransport,
  createManagementTransport,
  resolveConfig,
  type ClientOptions,
} from "./transport-web.js";

/**
 * Async client for the xAI API (gRPC-Web), for Cloudflare Workers and other
 * fetch-only runtimes (Deno, Bun, browsers, edge).
 *
 * ```ts
 * import { Client } from "xai-sdk-js/web";
 *
 * const client = new Client({ apiKey: env.XAI_API_KEY });
 * const chat = client.chat.create({ model: "grok-4" });
 * ```
 */
export const Client = createClientClass({ resolveConfig, createApiTransport, createManagementTransport });

export type { ClientOptions };
