import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";

export interface BuildResourceLoaderOptions {
	cwd: string;
	agentDir: string;
	/** Plugin extension files to load (absolute paths). */
	enabledPluginPaths?: string[];
	/** Bundled plugin factories to load. */
	bundledPlugins?: InlineExtension[];
	systemPrompt?: string;
}

/**
 * Builds a DefaultResourceLoader where the app is the sole gatekeeper of what
 * loads: no auto-discovery of extensions/skills/prompts/themes/context files
 * (avoids pi's project-trust prompt). Only explicitly enabled plugins and
 * bundled factories are loaded.
 */
export function buildResourceLoader(
	opts: BuildResourceLoaderOptions,
): DefaultResourceLoader {
	return new DefaultResourceLoader({
		cwd: opts.cwd,
		agentDir: opts.agentDir,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		additionalExtensionPaths: opts.enabledPluginPaths ?? [],
		extensionFactories: opts.bundledPlugins ?? [],
		systemPrompt: opts.systemPrompt,
	});
}
