import type { Database } from "bun:sqlite";

export interface MessageRow {
	id: string;
	sessionId: string;
	seq: number;
	role: string;
	model?: string | null;
	provider?: string | null;
	usageJson?: string | null;
	dataJson: string;
	createdAt: number;
}

export interface InsertMessage {
	id: string;
	sessionId: string;
	seq: number;
	role: string;
	model?: string | null;
	provider?: string | null;
	usageJson?: string | null;
	dataJson: string;
	createdAt: number;
}

const SELECT = `SELECT
	id, session_id AS sessionId, seq, role, model, provider,
	usage_json AS usageJson, data_json AS dataJson, created_at AS createdAt
FROM messages`;

export class MessagesRepo {
	constructor(private db: Database) {}

	insertMany(rows: InsertMessage[]): void {
		if (rows.length === 0) return;
		const insert = this.db.prepare(
			`INSERT INTO messages (id, session_id, seq, role, model, provider, usage_json, data_json, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		this.db.transaction(() => {
			for (const row of rows) {
				insert.run(
					row.id,
					row.sessionId,
					row.seq,
					row.role,
					row.model ?? null,
					row.provider ?? null,
					row.usageJson ?? null,
					row.dataJson,
					row.createdAt,
				);
			}
		})();
	}

	bySession(sessionId: string): MessageRow[] {
		return this.db
			.query(`${SELECT} WHERE session_id = ? ORDER BY seq`)
			.all(sessionId) as MessageRow[];
	}

	countBySession(sessionId: string): number {
		const row = this.db
			.query(`SELECT COUNT(*) AS n FROM messages WHERE session_id = ?`)
			.get(sessionId) as { n: number };
		return row.n;
	}

	deleteBySession(sessionId: string): void {
		this.db.query(`DELETE FROM messages WHERE session_id = ?`).run(sessionId);
	}
}
