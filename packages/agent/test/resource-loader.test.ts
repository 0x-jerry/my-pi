import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildResourceLoader } from "../src/resource-loader";

function tmpDir(): string {
	return mkdtempSync(join(tmpdir(), "my-pi-loader-"));
}

describe("buildResourceLoader", () => {
	test("loads nothing when no plugins configured", async () => {
		const cwd = tmpDir();
		const loader = buildResourceLoader({
			cwd,
			agentDir: join(cwd, ".pi-agent"),
		});
		await loader.reload();
		const extensions = loader.getExtensions();
		expect(extensions.extensions).toHaveLength(0);
		expect(loader.getSkills().skills).toHaveLength(0);
		expect(loader.getPrompts().prompts).toHaveLength(0);
	});

	test("passes enabled plugin paths through (error diagnostics reference them)", async () => {
		const cwd = tmpDir();
		const bogus = join(cwd, "missing-plugin.ts");
		const loader = buildResourceLoader({
			cwd,
			agentDir: join(cwd, ".pi-agent"),
			enabledPluginPaths: [bogus],
		});
		await loader.reload();
		const extensions = loader.getExtensions();
		expect(extensions.extensions).toHaveLength(0);
		expect(extensions.errors.some((e) => e.path === bogus)).toBe(true);
	});

	test("loads a real plugin file", async () => {
		const cwd = tmpDir();
		const pluginPath = join(cwd, "my-plugin.ts");
		writeFileSync(
			pluginPath,
			`
			import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
			import { Type } from "typebox";
			export default function (pi: ExtensionAPI) {
				pi.registerTool({
					name: "custom_hello",
					label: "Custom Hello",
					description: "Say hello",
					parameters: Type.Object({}),
					execute: async () => ({ content: [{ type: "text", text: "hi" }], details: {} }),
				});
			}
			`,
		);
		const loader = buildResourceLoader({
			cwd,
			agentDir: join(cwd, ".pi-agent"),
			enabledPluginPaths: [pluginPath],
		});
		await loader.reload();
		const extensions = loader.getExtensions();
		expect(extensions.errors).toHaveLength(0);
		expect(extensions.extensions).toHaveLength(1);
	});
});
