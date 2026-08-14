import { defineConfig } from "vitest/config"
import vue from "@vitejs/plugin-vue"

// Separate from vite.config.ts (whose root is src/mainview for the app build);
// vitest runs from the package root against the test/ directory.
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.ts"],
  },
})
