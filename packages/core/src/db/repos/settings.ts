import type { Database } from "bun:sqlite";

export interface SettingsRow {
	key: string;
	valueJson: string;
}

export class SettingsRepo {
	constructor(private db: Database) {}

	get(key: string): SettingsRow | null {
		return (
			(this.db
				.query(`SELECT key, value_json AS valueJson FROM settings WHERE key = ?`)
				.get(key) as SettingsRow | undefined) ?? null
		);
	}

	set(key: string, valueJson: string): void {
		this.db
			.query(
				`INSERT INTO settings (key, value_json) VALUES (?, ?)
				 ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
			)
			.run(key, valueJson);
	}

	all(): SettingsRow[] {
		return this.db.query(`SELECT key, value_json AS valueJson FROM settings`).all() as SettingsRow[];
	}
}
