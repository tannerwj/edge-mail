import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import client from "./web/vite.config.ts";

export default defineConfig({
  plugins: [...(client.plugins || []), cloudflare({ configPath: "./cloudflare.config.ts" })],
  define: { LOCAL_IDENTITY_ENABLED: "false" },
  build: { ...client.build, minify: true },
});
