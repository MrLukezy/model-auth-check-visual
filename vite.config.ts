import { defineConfig } from "vite"
import solidPlugin from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"

const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [tailwindcss(), solidPlugin()],
  server: {
    port: 1422,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  clearScreen: false,
})
