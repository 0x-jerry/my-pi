import { defineConfig } from "vitest/config"
import vue from "@vitejs/plugin-vue"
import Icons from "unplugin-icons/vite"

// Separate from vite.config.ts (whose root is src/mainview for the app build);
// vitest runs from the package root against the test/ directory.
export default defineConfig({
  plugins: [vue(), Icons({ compiler: "vue3" })],
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.ts"],
  },
})
