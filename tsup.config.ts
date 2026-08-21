import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/index-web.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  target: "node18",
  outDir: "dist",
  // Keep `node:` specifiers intact. tsup strips the prefix by default, and a
  // bare `fs/promises` does not resolve on Cloudflare Workers or other
  // fetch-only runtimes.
  removeNodeProtocol: false,
});
