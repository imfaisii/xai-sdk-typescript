import { createClientClass } from "./client-shared.js";
import { createApiTransport, createManagementTransport, resolveConfig, type ClientOptions } from "./transport.js";

/**
 * Async client for the xAI API (gRPC).
 *
 * ```ts
 * import { Client } from "xai-sdk-js";
 *
 * const client = new Client(); // uses XAI_API_KEY
 * const chat = client.chat.create({ model: "grok-4" });
 * ```
 */
export const Client = createClientClass({ resolveConfig, createApiTransport, createManagementTransport });

export type { ClientOptions };
