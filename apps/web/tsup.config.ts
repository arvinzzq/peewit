import { defineConfig } from "tsup";

export default defineConfig({
  entry: { server: "src/server.ts" },
  format: ["esm"],
  outDir: "dist",
  // Bundle everything — server.js is copied into CLI dist/web and must be self-contained
  // since no node_modules is available in a global npm install.
  noExternal: [/.*/],
  minify: true,
  esbuildOptions(options) {
    options.platform = "node";
  },
  // CJS packages (e.g. ws) use dynamic require() which ESM doesn't support.
  // Inject a createRequire shim so those calls resolve at runtime.
  banner: {
    js: `import { createRequire } from "module"; const require = createRequire(import.meta.url);`,
  },
});
