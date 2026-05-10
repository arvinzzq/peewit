import { defineConfig } from "tsup";

export default defineConfig({
  // app.tsx is a separate chunk because index.ts loads it via dynamic import.
  // Both entries bundle @vole/* workspace packages inline; third-party packages
  // (ink, chalk, react, …) are kept external and shipped as normal npm deps.
  entry: {
    index: "src/index.ts",
    app:   "src/app.tsx",
  },
  format: ["esm"],
  outDir: "dist",
  clean: true,
  minify: true,
  // Bundle workspace packages; everything else resolves from node_modules at runtime.
  noExternal: [/^@vole\//],
  esbuildOptions(options) {
    // React JSX transform (no manual React import needed)
    options.jsx = "automatic";
  },
  banner: {
    // Shebang so `vole` is executable without `node` prefix after `npm install -g`
    js: "#!/usr/bin/env node",
  },
});
