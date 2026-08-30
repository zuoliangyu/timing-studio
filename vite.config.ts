import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => ({
  base: mode === "pages" ? "/timing-studio/" : "/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Timing Studio",
        short_name: "Timing",
        description: "简洁、高质量的数字时序图编辑器",
        theme_color: "#f1f3f2",
        background_color: "#f1f3f2",
        display: "standalone",
        start_url: "."
      }
    })
  ],
  server: { host: "127.0.0.1", port: 1420, strictPort: true }
}));
