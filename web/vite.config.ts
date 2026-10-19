import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 엔진(../engine/src)을 그대로 가져와 브라우저에서 돌린다.
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { fs: { allow: [".."] } },
  worker: { format: "es" },
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
});
