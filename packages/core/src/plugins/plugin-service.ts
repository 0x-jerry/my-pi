import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";
import { existsSync } from "node:fs";
import type { AddPluginInput, PluginInfo } from "@my-pi/shared";
import type { InlineExtension } from "@my-pi/agent";
import { PluginsRepo, type PluginRow } from "../db/repos";

/** A plugin shipped inside the app (an inline pi extension factory). */
export interface BuiltinPlugin {
	id: string;
	name: string;
	description: string;
	factory: InlineExtension;
}

function toPluginInfo(row: PluginRow): PluginInfo {
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		sourceType: row.sourceType,
		source: row.source,
		scope: row.scope,
		workspaceId: row.workspaceId,
		enabled: row.enabled,
		installedAt: row.installedAt,
		updatedAt: row.updatedAt,
	};
}

/**
 * Registry of plugins (builtin + path-based pi extensions) with per-workspace
 * enable/disable. Owns what the agent package is allowed to load.
 */
export class PluginService {
	constructor(
		private repo: PluginsRepo,
		private builtins: Map<string, BuiltinPlugin>,
	) {
		// Seed builtins (keeps existing enable state via upsert).
		const now = Date.now();
		for (const b of builtins.values()) {
			this.repo.upsert({
				id: b.id,
				name: b.name,
				description: b.description,
				sourceType: "builtin",
				source: b.id,
				scope: "global",
				enabled: true,
				installedAt: now,
				updatedAt: now,
			});
		}
	}

	list(workspaceId?: string): PluginInfo[] {
		const rows = this.repo.all();
		const filtered = workspaceId
			? rows.filter(
					(r) =>
						r.scope === "global" ||
						(r.scope === "workspace" && r.workspaceId === workspaceId),
				)
			: rows;
		return filtered.map(toPluginInfo);
	}

	get(id: string): PluginInfo {
		const row = this.repo.byId(id);
		if (!row) throw new Error(`Plugin not found: ${id}`);
		return toPluginInfo(row);
	}

	addPathPlugin(input: AddPluginInput): PluginInfo {
		const source = resolve(input.source);
		if (!existsSync(source)) {
			throw new Error(`Plugin path not found: ${input.source}`);
		}
		const scope = input.scope ?? "global";
		if (scope === "workspace" && !input.workspaceId) {
			throw new Error("workspaceId is required for workspace-scoped plugins");
		}
		const now = Date.now();
		const id = `path:${createHash("sha1")
			.update(`${scope}:${input.workspaceId ?? ""}:${source}`)
			.digest("hex")
			.slice(0, 16)}`;
		this.repo.upsert({
			id,
			name: input.name ?? basename(source),
			description: undefined,
			sourceType: "path",
			source,
			scope,
			workspaceId: input.workspaceId,
			enabled: true,
			installedAt: now,
			updatedAt: now,
		});
		return this.get(id);
	}

	remove(id: string): void {
		this.repo.remove(id);
	}

	/** Remove all workspace-scoped plugins registered for a workspace. */
	removeForWorkspace(workspaceId: string): void {
		this.repo.deleteByWorkspace(workspaceId);
	}

	setEnabled(id: string, enabled: boolean): void {
		this.repo.setEnabled(id, enabled);
	}

	/** Resolve what to load for a workspace's agents. */
	resolveForWorkspace(
		workspaceId: string,
	): { paths: string[]; factories: InlineExtension[] } {
		const rows = this.repo
			.all()
			.filter(
				(r) =>
					r.enabled &&
					(r.scope === "global" ||
						(r.scope === "workspace" && r.workspaceId === workspaceId)),
			);
		const paths: string[] = [];
		const factories: InlineExtension[] = [];
		for (const r of rows) {
			if (r.sourceType === "path") paths.push(r.source);
			else {
				const builtin = this.builtins.get(r.id);
				if (builtin) factories.push(builtin.factory);
			}
		}
		return { paths, factories };
	}
}
