# xai-sdk-js

TypeScript/JavaScript SDK for the [xAI API](https://docs.x.ai), ported from the official [xai-sdk](https://github.com/xai-org/xai-sdk-python) Python package.

Talks to `api.x.ai` over **gRPC** (Connect-ES). Async-first. Node.js 18+.

## Install

```bash
npm install xai-sdk-js
# or
bun add xai-sdk-js
# or
pnpm add xai-sdk-js
```

Set your API key:

```bash
export XAI_API_KEY=xai-...
# optional, for Collections management
export XAI_MANAGEMENT_KEY=...
```

## Quick start

```ts
import { Client, user, system } from "xai-sdk-js";

const client = new Client(); // reads XAI_API_KEY

const chat = client.chat.create({
  model: "grok-4",
  messages: [system("You are helpful.")],
});
chat.append(user("Explain black holes in one sentence."));

const response = await chat.sample();
console.log(response.content);
console.log("cost USD:", response.costUsd);
```

### Streaming

```ts
const chat = client.chat.create({ model: "grok-4" });
chat.append(user("Write a short poem about space."));

for await (const [response, chunk] of chat.stream()) {
  const delta = chunk.content;
  if (delta) process.stdout.write(delta);
}
```

### Tools & search

```ts
import { Client, user, webSearch, SearchParameters, webSource } from "xai-sdk-js";

const client = new Client();
const chat = client.chat.create({
  model: "grok-4",
  tools: [webSearch()],
  searchParameters: new SearchParameters({
    mode: "auto",
    sources: [webSource()],
    returnCitations: true,
  }),
});
chat.append(user("What are the latest developments from xAI?"));
const res = await chat.sample();
console.log(res.content);
```

### Images

```ts
const img = await client.image.sample("A watercolor fox under starlight", "grok-imagine-image", {
  aspectRatio: "16:9",
  resolution: "2k",
});
console.log(img.url);
```

### Video (deferred + poll)

```ts
const video = await client.video.generate("A drone shot over misty mountains", "grok-imagine-video", {
  aspectRatio: "16:9",
  duration: 5,
});
console.log(video.url);
```

### Files

```ts
const file = await client.files.upload("./notes.pdf");
console.log(file.id, file.filename);

const bytes = await client.files.content(file.id);
```

### Batch

```ts
import { user } from "xai-sdk-js";

const batch = await client.batch.create("capitals");
const chats = ["UK", "USA", "Egypt"].map((country) => {
  const c = client.chat.create({
    model: "grok-4",
    batchRequestId: `capital_${country}`,
  });
  c.append(user(`Capital of ${country}?`));
  return c;
});
await client.batch.add(batch.batchId, chats);
const page = await client.batch.listBatchResults(batch.batchId);
for (const r of page.succeeded) {
  console.log(r.batchRequestId, r.response.content);
}
```

### Auth / models / tokenize

```ts
const info = await client.auth.getApiKeyInfo();
const models = await client.models.listLanguageModels();
const tokens = await client.tokenize.tokenizeText("hello world", "grok-4");
```

### Collections (needs management key)

```ts
const client = new Client({ managementApiKey: process.env.XAI_MANAGEMENT_KEY });
const col = await client.collections.create("docs", { modelName: "grok-embedding" });
await client.collections.uploadDocument(col.collectionId, "readme.md", "# Hello", {
  waitForIndexing: true,
});
const hits = await client.collections.search("hello", [col.collectionId], { limit: 5 });
```

## Client options

```ts
new Client({
  apiKey: "...",                 // default: process.env.XAI_API_KEY
  managementApiKey: "...",       // default: process.env.XAI_MANAGEMENT_KEY
  apiHost: "api.x.ai",
  managementApiHost: "management-api.x.ai",
  timeoutMs: 27 * 60 * 1000,
  metadata: { "x-custom": "value" },
  useInsecureChannel: false,     // local/testing only
});
```

## API surface

| Property | Description |
| --- | --- |
| `client.chat` | Conversations: `create`, `sample` / `stream`, deferred, parse, compact, stored completions |
| `client.image` | Image generation / editing |
| `client.video` | Video generate / extend (deferred) |
| `client.files` | Upload, list, get, delete, content, public URLs |
| `client.batch` | Batch create / add / list / results |
| `client.collections` | RAG collections (management API) + document search |
| `client.models` | List/get language, embedding, image models |
| `client.tokenize` | Tokenize text |
| `client.auth` | API key info |

Message helpers: `user`, `system`, `assistant`, `developer`, `toolResult`, `text`, `image`, `file`, `tool`, `requiredTool`.

Tool helpers: `webSearch`, `xSearch`, `codeExecution`, `collectionsSearch`, `mcp`, `functionTool`.

Cost helper: `costUsdFromUsage(usage)` / `response.costUsd`.

## Proto types

Generated protobuf types live under the package build output and can be imported if you need raw messages:

```ts
import type { GetChatCompletionResponse } from "xai-sdk-js";
```

(Most apps only need the high-level clients.)

## Development

```bash
bun install
bun run gen       # buf generate from proto/
bun run typecheck
bun test
bun run build     # tsup → dist/
```

## License

Apache-2.0 — same as the Python SDK and xAI protos where applicable.
