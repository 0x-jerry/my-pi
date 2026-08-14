import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
	plugins: [vue()],
	// Relative asset URLs so the packaged build resolves assets under the
	// views:// scheme (which maps exact paths, not absolute /assets/...).
	base: "./",
	root: "src/mainview",
	build: {
		outDir: "../../dist",
		emptyOutDir: true,
	},
	server: {
		port: 5173,
		strictPort: true,
	},
});
