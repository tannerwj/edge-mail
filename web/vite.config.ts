import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "framework",
              test: /\/node_modules\/(?:react|react-dom|scheduler|@tanstack)\//,
            },
          ],
        },
      },
      onLog(level, log, handler) {
        // React Server Component directives have no effect in a browser-only bundle.
        if (log.code !== "MODULE_LEVEL_DIRECTIVE") handler(level, log);
      },
    },
  },
});
