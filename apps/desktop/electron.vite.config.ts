import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ["@teamaligned/shared", "@teamaligned/agent-runtime"],
      }),
    ],
    resolve: {
      alias: {
        "@shared": resolve(__dirname, "../../packages/shared/src"),
        "@runtime": resolve(__dirname, "../../packages/agent-runtime/src"),
        "@teamaligned/shared": resolve(__dirname, "../../packages/shared/src"),
        "@teamaligned/agent-runtime": resolve(__dirname, "../../packages/agent-runtime/src"),
      },
    },
  },
  preload: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ["@teamaligned/shared"],
      }),
    ],
    resolve: {
      alias: {
        "@shared": resolve(__dirname, "../../packages/shared/src"),
        "@teamaligned/shared": resolve(__dirname, "../../packages/shared/src"),
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        "@": resolve(__dirname, "./src/renderer/src"),
        "@shared": resolve(__dirname, "../../packages/shared/src"),
        "@teamaligned/shared": resolve(__dirname, "../../packages/shared/src"),
      },
    },
    plugins: [react()],
  },
});
