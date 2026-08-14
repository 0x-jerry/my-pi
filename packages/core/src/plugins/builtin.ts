import { Type } from "typebox";
import type { ExtensionAPI } from "@my-pi/agent";
import type { BuiltinPlugin } from "./plugin-service";

/** Builtin plugins shipped with the app. */
export function builtinPlugins(): Map<string, BuiltinPlugin> {
	const stats: BuiltinPlugin = {
		id: "builtin:system-stats",
		name: "System Stats",
		description:
			"Adds a system_stats tool reporting uptime, memory usage, and platform.",
		factory: (pi: ExtensionAPI) => {
			pi.registerTool({
				name: "system_stats",
				label: "System Stats",
				description: "Get system uptime, memory usage, and platform info.",
				parameters: Type.Object({}),
				execute: async () => ({
					content: [
						{
							type: "text",
							text: `uptime=${Math.round(process.uptime())}s platform=${process.platform} memoryRss=${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
						},
					],
					details: {},
				}),
			});
		},
	};
	return new Map([[stats.id, stats]]);
}
