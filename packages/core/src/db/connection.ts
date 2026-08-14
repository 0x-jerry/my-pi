import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_DB_PATH =
	process.env.MY_PI_DB_PATH ?? join(homedir(), ".my-pi", "my-pi.db");

export function openDatabase(path: string = DEFAULT_DB_PATH): Database {
	mkdirSync(dirname(path), { recursive: true });
	const db = new Database(path, { create: true });
	db.run("PRAGMA journal_mode = WAL");
	// Referential integrity is app-managed; FK constraints are deliberately OFF.
	db.run("PRAGMA foreign_keys = OFF");
	db.run("PRAGMA busy_timeout = 5000");
	// The db may hold provider credentials (credentials table) — restrict file
	// access to the owner, matching pi's own auth.json posture (0600). The WAL
	// sidecars are created lazily by sqlite alongside the main file; chmod them
	// too when present.
	for (const p of [path, `${path}-wal`, `${path}-shm`]) {
		try {
			chmodSync(p, 0o600);
		} catch {
			// Best-effort; e.g. sidecar not created yet or read-only fs.
		}
	}
	return db;
}
