import path from "path"
import crypto from "crypto"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Polyfill for Node < 20.12 — Vite's worker bundling uses crypto.hash().
if (typeof (crypto as any).hash !== "function") {
  ;(crypto as any).hash = (algorithm: string, data: crypto.BinaryLike, outputEncoding?: crypto.BinaryToTextEncoding) => {
    const h = crypto.createHash(algorithm).update(data)
    return outputEncoding ? h.digest(outputEncoding) : h.digest()
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // ffmpeg.wasm needs cross-origin isolation; exclude it from the optimizer
  // so its Worker is loaded at runtime from the unpkg CDN we point to.
  optimizeDeps: {
    exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"],
  },
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
    proxy: {
      "/jobs": "http://localhost:5000",
      "/download": "http://localhost:5000",
      "/download-all": "http://localhost:5000",
      "/clear-all": "http://localhost:5000",
      "/health": "http://localhost:5000",
    },
  },
})
