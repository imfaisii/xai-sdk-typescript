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

### API key resolution

The client resolves secrets in this order (first hit wins):

1. Constructor options: `new Client({ apiKey: "..." })`
2. Process environment: `export XAI_API_KEY=...` (and `XAI_MANAGEMENT_KEY`)
3. Dotenv files in the working directory (or `envDir`):

| File | Typical use |
| --- | --- |
| `.env` | defaults |
| `.env.<mode>` | `.env.production`, `.env.staging`, `.env.development` (`mode` = `XAI_ENV` or `NODE_ENV`) |
| other `.env.*` | custom env names |
| `.env.local` | local overrides (usually gitignored) |
| `.env.<mode>.local` | mode-specific local overrides |

Existing shell/`process.env` values are never overwritten by files. No `dotenv` dependency is required.

```bash
# shell
export XAI_API_KEY=xai-...
export XAI_MANAGEMENT_KEY=...   # optional, Collections management

# or a file
echo 'XAI_API_KEY=xai-...' >> .env.local
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

### Multi-turn + prompt cache (lower cost)

xAI sticky prompt-cache routing needs a stable conversation id on every chat RPC as header `x-grok-conv-id`. Pass it as `conversationId` on `chat.create` — the SDK sends it automatically on sample/stream/defer/parse/compact.

```ts
import { Client, system, user } from "xai-sdk-js";

const client = new Client();
const conversationId = "thread_abc123"; // stable per app conversation
let previousResponseId: string | undefined;

// Turn 1
{
  const chat = client.chat.create({
    model: "grok-4",
    conversationId,
    storeMessages: true,
    messages: [system("You are helpful."), user("What is prompt caching?")],
  });
  const res = await chat.sample();
  previousResponseId = res.id;
  console.log(res.content);
  console.log("cached tokens:", res.usage?.cachedPromptTextTokens);
}

// Turn 2 — only the new user message; server holds prior turns via previousResponseId
{
  const chat = client.chat.create({
    model: "grok-4",
    conversationId,
    storeMessages: true,
    previousResponseId,
    messages: [user("Show a short example.")],
  });
  const res = await chat.sample();
  previousResponseId = res.id;
  console.log("cached tokens:", res.usage?.cachedPromptTextTokens);
}
```

Best practices:

1. Always pass a stable `conversationId` for multi-turn (do not mint a new one each request).
2. Set `storeMessages: true` when chaining with `previousResponseId`.
3. Follow-ups: send only the **new** user message when using `previousResponseId` (don’t resend full history).
4. If you resend full history instead of chaining, don’t edit/reorder earlier turns.
5. Watch `usage.cachedPromptTextTokens` — stuck at `0` usually means the id/header/routing is wrong.
6. One-shot helpers (titles, classifiers): omit `conversationId` or use a unique id; keep `storeMessages: false` (the default).

You can also set client-wide metadata `x-grok-conv-id`, but per-chat `conversationId` is correct for concurrent threads (it wins on that header).

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
  apiKey: "...",                 // else XAI_API_KEY env / .env*
  managementApiKey: "...",       // else XAI_MANAGEMENT_KEY env / .env*
  envDir: process.cwd(),         // directory scanned for .env* files
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

## Releasing (npm + GitHub)

The npm package is linked to this repo via `package.json` `repository` / `homepage` / `bugs`.

Publishing is automated by [`.github/workflows/release.yml`](.github/workflows/release.yml):

1. Add repo secret **`NPM_TOKEN`** (npm access token with publish access)  
   GitHub → **Settings → Secrets and variables → Actions → New repository secret**
2. Bump and ship a tag:

```bash
# bump package.json + src/version.ts, commit, tag vX.Y.Z, push
./scripts/release.sh 0.1.2

# or tag the version already in package.json
./scripts/release.sh
```

Pushing tag `v*` runs CI build/tests, `npm publish`, and creates a GitHub Release with notes.  
Creating a GitHub Release from an existing `v*` tag also triggers publish (skips npm if that version already exists).

## License

Apache-2.0 — same as the Python SDK and xAI protos where applicable.
