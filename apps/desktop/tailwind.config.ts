import type { Config } from "tailwindcss";

export default {
  content: ["./src/renderer/index.html", "./src/renderer/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#141220",
        mist: "#f6f7fb",
        lavender: "#7c3aed",
        lilac: "#ede9fe",
        cyan: "#06b6d4",
        emerald: "#10b981",
        amber: "#f59e0b",
      },
      boxShadow: {
        soft: "0 16px 48px -24px rgba(17, 24, 39, 0.28)",
      },
      borderRadius: {
        "4xl": "2rem",
      },
      fontFamily: {
        sans: ["Inter", "PingFang SC", "Noto Sans SC", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;

