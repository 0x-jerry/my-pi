import type { Database } from "bun:sqlite";
import type { TokenUsageRow } from "@my-pi/shared";

export interface InsertTokenUsage {
	sessionId: string;
	messageId?: string;
	kind: "assistant" | "tool";
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	reasoning?: number;
	cost: number;
	createdAt: number;
}

const SELECT = `SELECT
	id, session_id AS sessionId, message_id AS messageId, kind,
	input, output, cache_read AS cacheRead, cache_write AS cacheWrite,
	reasoning, cost, created_at AS createdAt
FROM token_usage`;

export class TokenUsageRepo {
	constructor(private db: Database) {}

	insertMany(rows: InsertTokenUsage[]): void {
		if (rows.length === 0) return;
		const insert = this.db.prepare(
			`INSERT INTO token_usage
			 (session_id, message_id, kind, input, output, cache_read, cache_write, reasoning, cost, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		this.db.transaction(() => {
			for (const row of rows) {
				insert.run(
					row.sessionId,
					row.messageId ?? null,
					row.kind,
					row.input,
					row.output,
					row.cacheRead,
					row.cacheWrite,
					row.reasoning ?? null,
					row.cost,
					row.createdAt,
				);
			}
		})();
	}

	bySession(sessionId: string): TokenUsageRow[] {
		return this.db
			.query(`${SELECT} WHERE session_id = ? ORDER BY id`)
			.all(sessionId) as TokenUsageRow[];
	}

	deleteBySession(sessionId: string): void {
		this.db.query(`DELETE FROM token_usage WHERE session_id = ?`).run(sessionId);
	}
}
