import type { Database } from "bun:sqlite";
import { MIGRATIONS } from "./schema";

/** Apply pending migrations; tracked via PRAGMA user_version. Idempotent. */
export function migrate(db: Database): void {
	const row = db.query("PRAGMA user_version").get() as { user_version: number };
	let current = row.user_version;
	for (let version = current; version < MIGRATIONS.length; version++) {
		db.transaction(() => {
			for (const statement of MIGRATIONS[version]) db.run(statement);
			db.run(`PRAGMA user_version = ${version + 1}`);
		})();
		current = version + 1;
	}
}
