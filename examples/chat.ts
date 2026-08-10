/**
 * Minimal chat example. Requires XAI_API_KEY.
 *
 *   bun run examples/chat.ts
 */
import { Client, user, system } from "../src/index.js";

const client = new Client();

const chat = client.chat.create({
  model: process.env.XAI_MODEL ?? "grok-4",
  messages: [system("Reply in one short sentence.")],
});
chat.append(user(process.argv[2] ?? "Say hello from the xAI TypeScript SDK."));

const response = await chat.sample();
console.log(response.content);
if (response.usage) {
  console.log("usage:", response.usage);
}
