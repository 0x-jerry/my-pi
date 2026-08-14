import type { Database } from "bun:sqlite";
import type { PluginScope, PluginSourceType } from "@my-pi/shared";

export interface PluginRow {
	id: string;
	name: string;
	description?: string;
	sourceType: PluginSourceType;
	source: string;
	scope: PluginScope;
	workspaceId?: string;
	enabled: boolean;
	installedAt: number;
	updatedAt: number;
}

const SELECT = `SELECT
	id, name, description, source_type AS sourceType, source, scope,
	workspace_id AS workspaceId, enabled, installed_at AS installedAt,
	updated_at AS updatedAt
FROM plugins`;

function mapRow(row: Record<string, unknown>): PluginRow {
	return { ...row, enabled: !!row.enabled } as unknown as PluginRow;
}

export class PluginsRepo {
	constructor(private db: Database) {}

	/**
	 * Insert or refresh metadata. On conflict, name/description are updated but
	 * `enabled` is preserved so seeding builtins doesn't reset user toggles.
	 */
	upsert(row: PluginRow): void {
		this.db
			.query(
				`INSERT INTO plugins
				 (id, name, description, source_type, source, scope, workspace_id, enabled, installed_at, updated_at, config_json)
				 VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL)
				 ON CONFLICT(id) DO UPDATE SET
					name = excluded.name,
					description = excluded.description,
					updated_at = excluded.updated_at`,
			)
			.run(
				row.id,
				row.name,
				row.description ?? null,
				row.sourceType,
				row.source,
				row.scope,
				row.workspaceId ?? null,
				row.installedAt,
				row.updatedAt,
			);
	}

	all(): PluginRow[] {
		return (this.db.query(`${SELECT} ORDER BY installed_at`).all() as Record<string, unknown>[]).map(mapRow);
	}

	byId(id: string): PluginRow | null {
		const row = this.db.query(`${SELECT} WHERE id = ?`).get(id) as
			| Record<string, unknown>
			| undefined;
		return row ? mapRow(row) : null;
	}

	remove(id: string): void {
		this.db.query(`DELETE FROM plugins WHERE id = ?`).run(id);
	}

	setEnabled(id: string, enabled: boolean): void {
		this.db
			.query(`UPDATE plugins SET enabled = ?, updated_at = ? WHERE id = ?`)
			.run(enabled ? 1 : 0, Date.now(), id);
	}

	deleteByWorkspace(workspaceId: string): void {
		this.db
			.query(`DELETE FROM plugins WHERE scope = 'workspace' AND workspace_id = ?`)
			.run(workspaceId);
	}
}
