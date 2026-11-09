import { defineConfig } from "vite";

const server = "http://127.0.0.1:4317";

export default defineConfig({
  root: "src/client",
  build: { outDir: "../../dist/client", emptyOutDir: true },
  // rewriteWsOrigin: the server only accepts its own origin on /ws
  server: { proxy: { "/api": server, "/ws": { target: server, ws: true, rewriteWsOrigin: true } } },
});
