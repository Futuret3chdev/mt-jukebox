import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { handleApi } from "./server/http";

function jukeboxApi(): Plugin {
  return {
    name: "jukebox-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/api")) {
          next();
          return;
        }
        void handleApi(req, res);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/api")) {
          next();
          return;
        }
        void handleApi(req, res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), jukeboxApi()],
  server: { host: "0.0.0.0", port: 8080, allowedHosts: true },
  preview: { host: "0.0.0.0", port: 8080 },
});
