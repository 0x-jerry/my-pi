import type { Database } from "bun:sqlite";

export interface CredentialRow {
	providerId: string;
	type: string;
	credentialJson: string;
	updatedAt: number;
}

/** Metadata only — never carries secret material. */
export interface CredentialMetaRow {
	providerId: string;
	type: string;
}

/** Typed CRUD for the credentials table (pi CredentialStore backend). */
export class CredentialsRepo {
	constructor(private db: Database) {}

	get(providerId: string): CredentialRow | null {
		return (
			(this.db
				.query(
					`SELECT
						provider_id AS providerId, type,
						credential_json AS credentialJson, updated_at AS updatedAt
					FROM credentials WHERE provider_id = ?`,
				)
				.get(providerId) as CredentialRow | undefined) ?? null
		);
	}

	upsert(
		providerId: string,
		type: string,
		credentialJson: string,
		updatedAt: number,
	): void {
		this.db
			.query(
				`INSERT INTO credentials (provider_id, type, credential_json, updated_at)
				 VALUES (?, ?, ?, ?)
				 ON CONFLICT(provider_id) DO UPDATE SET
					type = excluded.type,
					credential_json = excluded.credential_json,
					updated_at = excluded.updated_at`,
			)
			.run(providerId, type, credentialJson, updatedAt);
	}

	delete(providerId: string): void {
		this.db
			.query(`DELETE FROM credentials WHERE provider_id = ?`)
			.run(providerId);
	}

	/** Credential metadata only — never exposes credential_json. */
	list(): CredentialMetaRow[] {
		return this.db
			.query(`SELECT provider_id AS providerId, type FROM credentials`)
			.all() as CredentialMetaRow[];
	}
}
