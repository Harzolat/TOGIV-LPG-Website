import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Shared domain logic: consume TS source directly (the CJS dist that
      // the API requires can't be statically analysed by rollup for named
      // re-exports from `export *`)
      "@togi/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
    },
  },
  server: {
    // 5173 is often occupied by another local dev server — 5175 keeps this
    // app's origin deterministic for the API's CORS/Origin allowlist (.env)
    port: 5175,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
