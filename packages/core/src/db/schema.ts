/**
 * Schema migrations. MIGRATIONS[i] is the set of statements that upgrade a
 * database from user_version i to i+1. See migrate() in migrations.ts.
 */
export const MIGRATIONS: string[][] = [
	[
		`CREATE TABLE IF NOT EXISTS workspaces (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			path TEXT NOT NULL UNIQUE,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,

		`CREATE TABLE IF NOT EXISTS sessions (
			id TEXT PRIMARY KEY,
			workspace_id TEXT NOT NULL,
			title TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'idle',
			model_provider TEXT,
			model_id TEXT,
			thinking_level TEXT,
			system_prompt TEXT,
			forked_from_session_id TEXT,
			forked_from_message_seq INTEGER,
			message_count INTEGER NOT NULL DEFAULT 0,
			total_input_tokens INTEGER NOT NULL DEFAULT 0,
			total_output_tokens INTEGER NOT NULL DEFAULT 0,
			total_cache_read INTEGER NOT NULL DEFAULT 0,
			total_cache_write INTEGER NOT NULL DEFAULT 0,
			total_cost REAL NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			last_activity_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_id)`,

		`CREATE TABLE IF NOT EXISTS messages (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			seq INTEGER NOT NULL,
			role TEXT NOT NULL,
			model TEXT,
			provider TEXT,
			usage_json TEXT,
			data_json TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			UNIQUE(session_id, seq)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, seq)`,

		`CREATE TABLE IF NOT EXISTS token_usage (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id TEXT NOT NULL,
			message_id TEXT,
			kind TEXT NOT NULL,
			input INTEGER NOT NULL DEFAULT 0,
			output INTEGER NOT NULL DEFAULT 0,
			cache_read INTEGER NOT NULL DEFAULT 0,
			cache_write INTEGER NOT NULL DEFAULT 0,
			reasoning INTEGER,
			cost REAL NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_token_usage_session ON token_usage(session_id)`,

		`CREATE TABLE IF NOT EXISTS plugins (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			description TEXT,
			source_type TEXT NOT NULL,
			source TEXT NOT NULL,
			scope TEXT NOT NULL,
			workspace_id TEXT,
			enabled INTEGER NOT NULL DEFAULT 1,
			installed_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			config_json TEXT
		)`,

		`CREATE TABLE IF NOT EXISTS settings (
			key TEXT PRIMARY KEY,
			value_json TEXT NOT NULL
		)`,
	],

	// Migration 2: provider credentials (pi CredentialStore backend).
	// One credential per provider; the full Credential blob is stored as JSON
	// so both api_key and oauth credentials (incl. provider env) round-trip.
	// `type` is denormalized so list() can serve CredentialInfo metadata
	// without touching secret material.
	[
		`CREATE TABLE IF NOT EXISTS credentials (
			provider_id TEXT PRIMARY KEY,
			type TEXT NOT NULL,
			credential_json TEXT NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
	],
];
