import type { Database } from "bun:sqlite";
import type { SessionStatus, ThinkingLevel } from "@my-pi/shared";

export interface SessionRow {
	id: string;
	workspaceId: string;
	title: string;
	status: SessionStatus;
	modelProvider?: string;
	modelId?: string;
	thinkingLevel?: ThinkingLevel;
	systemPrompt?: string;
	forkedFromSessionId?: string;
	forkedFromMessageSeq?: number;
	messageCount: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCacheRead: number;
	totalCacheWrite: number;
	totalCost: number;
	createdAt: number;
	updatedAt: number;
	lastActivityAt: number;
}

export interface SessionRollupDelta {
	status: SessionStatus;
	messageCountDelta: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	lastActivityAt: number;
}

const SELECT = `SELECT
	id, workspace_id AS workspaceId, title, status,
	model_provider AS modelProvider, model_id AS modelId,
	thinking_level AS thinkingLevel, system_prompt AS systemPrompt,
	forked_from_session_id AS forkedFromSessionId,
	forked_from_message_seq AS forkedFromMessageSeq,
	message_count AS messageCount,
	total_input_tokens AS totalInputTokens,
	total_output_tokens AS totalOutputTokens,
	total_cache_read AS totalCacheRead,
	total_cache_write AS totalCacheWrite,
	total_cost AS totalCost,
	created_at AS createdAt, updated_at AS updatedAt,
	last_activity_at AS lastActivityAt
FROM sessions`;

export class SessionsRepo {
	constructor(private db: Database) {}

	insert(row: SessionRow): void {
		this.db
			.query(
				`INSERT INTO sessions (
					id, workspace_id, title, status, model_provider, model_id,
					thinking_level, system_prompt, forked_from_session_id,
					forked_from_message_seq, message_count, total_input_tokens,
					total_output_tokens, total_cache_read, total_cache_write,
					total_cost, created_at, updated_at, last_activity_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				row.id,
				row.workspaceId,
				row.title,
				row.status,
				row.modelProvider ?? null,
				row.modelId ?? null,
				row.thinkingLevel ?? null,
				row.systemPrompt ?? null,
				row.forkedFromSessionId ?? null,
				row.forkedFromMessageSeq ?? null,
				row.messageCount,
				row.totalInputTokens,
				row.totalOutputTokens,
				row.totalCacheRead,
				row.totalCacheWrite,
				row.totalCost,
				row.createdAt,
				row.updatedAt,
				row.lastActivityAt,
			);
	}

	all(): SessionRow[] {
		return this.db.query(`${SELECT} ORDER BY last_activity_at DESC`).all() as SessionRow[];
	}

	allByWorkspace(workspaceId: string): SessionRow[] {
		return this.db
			.query(`${SELECT} WHERE workspace_id = ? ORDER BY last_activity_at DESC`)
			.all(workspaceId) as SessionRow[];
	}

	byId(id: string): SessionRow | null {
		return (
			(this.db.query(`${SELECT} WHERE id = ?`).get(id) as SessionRow | undefined) ??
			null
		);
	}

	remove(id: string): void {
		this.db.query(`DELETE FROM sessions WHERE id = ?`).run(id);
	}

	/** Apply a run-end delta: new status, message count, and token rollups. */
	updateAfterRun(id: string, delta: SessionRollupDelta): void {
		this.db
			.query(
				`UPDATE sessions SET
					status = ?,
					message_count = message_count + ?,
					total_input_tokens = total_input_tokens + ?,
					total_output_tokens = total_output_tokens + ?,
					total_cache_read = total_cache_read + ?,
					total_cache_write = total_cache_write + ?,
					total_cost = total_cost + ?,
					updated_at = ?,
					last_activity_at = ?
				WHERE id = ?`,
			)
			.run(
				delta.status,
				delta.messageCountDelta,
				delta.input,
				delta.output,
				delta.cacheRead,
				delta.cacheWrite,
				delta.cost,
				delta.lastActivityAt,
				delta.lastActivityAt,
				id,
			);
	}

	touch(id: string, status: SessionStatus): void {
		const now = Date.now();
		this.db
			.query(
				`UPDATE sessions SET status = ?, updated_at = ?, last_activity_at = ? WHERE id = ?`,
			)
			.run(status, now, now, id);
	}
}
