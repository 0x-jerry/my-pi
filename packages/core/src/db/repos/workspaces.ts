import type { Database } from "bun:sqlite";

export interface WorkspaceRow {
	id: string;
	name: string;
	path: string;
	createdAt: number;
	updatedAt: number;
}

const SELECT = `SELECT id, name, path, created_at AS createdAt, updated_at AS updatedAt FROM workspaces`;

export class WorkspacesRepo {
	constructor(private db: Database) {}

	insert(row: WorkspaceRow): void {
		this.db
			.query(
				`INSERT INTO workspaces (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
			)
			.run(row.id, row.name, row.path, row.createdAt, row.updatedAt);
	}

	all(): WorkspaceRow[] {
		return this.db.query(`${SELECT} ORDER BY created_at`).all() as WorkspaceRow[];
	}

	byId(id: string): WorkspaceRow | null {
		return (
			(this.db.query(`${SELECT} WHERE id = ?`).get(id) as
				| WorkspaceRow
				| undefined) ?? null
		);
	}

	byPath(path: string): WorkspaceRow | null {
		return (
			(this.db.query(`${SELECT} WHERE path = ?`).get(path) as
				| WorkspaceRow
				| undefined) ?? null
		);
	}

	updateName(id: string, name: string): void {
		this.db
			.query(`UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ?`)
			.run(name, Date.now(), id);
	}

	remove(id: string): void {
		this.db.query(`DELETE FROM workspaces WHERE id = ?`).run(id);
	}
}
