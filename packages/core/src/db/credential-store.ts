import type {
	Credential,
	CredentialInfo,
	CredentialStore,
} from "@my-pi/agent";
import type { CredentialsRepo } from "./repos/credentials";

/**
 * CredentialStore backed by sqlite (credentials table). Implements pi-ai's
 * CredentialStore contract: read / list / modify / delete.
 *
 * Serialization: pi's contract requires mutual exclusion per provider id, and
 * OAuth refresh runs *inside* modify (network I/O), so a sqlite write
 * transaction must never be held across the async fn. We serialize per
 * provider with an in-process promise chain instead. Single-process only:
 * cross-process locking is not needed while at most one my-pi process opens a
 * given db file.
 *
 * Error semantics: read resolves undefined for missing/corrupt entries;
 * rejections only occur on storage failure. modify propagates fn rejections
 * without writing; returning undefined leaves the entry unchanged and resolves
 * with the current credential (pi contract, used by login-during-refresh).
 */
export class SqliteCredentialStore implements CredentialStore {
	private queues = new Map<string, Promise<unknown>>();

	constructor(private repo: CredentialsRepo) {}

	async read(providerId: string): Promise<Credential | undefined> {
		// Serialized per provider so a read issued during an in-flight modify
		// (e.g. OAuth refresh) observes the post-write credential.
		return this.enqueue(providerId, async () => this.readUnsafe(providerId));
	}

	private readUnsafe(providerId: string): Credential | undefined {
		const row = this.repo.get(providerId);
		if (!row) return undefined;
		try {
			return JSON.parse(row.credentialJson) as Credential;
		} catch {
			// Corrupt stored credential → treat as absent (best-effort store).
			return undefined;
		}
	}

	async list(): Promise<readonly CredentialInfo[]> {
		return this.repo.list().map((row) => ({
			providerId: row.providerId,
			type: row.type as Credential["type"],
		}));
	}

	async modify(
		providerId: string,
		fn: (
			current: Credential | undefined,
		) => Promise<Credential | undefined>,
	): Promise<Credential | undefined> {
		return this.enqueue(providerId, async () => {
			const current = this.readUnsafe(providerId);
			const next = await fn(current);
			if (next === undefined) return current; // leave entry unchanged
			this.repo.upsert(
				providerId,
				next.type,
				JSON.stringify(next),
				Date.now(),
			);
			return next;
		});
	}

	async delete(providerId: string): Promise<void> {
		await this.enqueue(providerId, async () => {
			this.repo.delete(providerId);
		});
	}

	/** Serialize operations per provider: chain onto the previous op's tail. */
	private enqueue<T>(providerId: string, op: () => Promise<T>): Promise<T> {
		const prev = this.queues.get(providerId) ?? Promise.resolve();
		// prev never rejects (we store a settled tail), so op always runs.
		const run = prev.then(op);
		// Keep a settled reference so the chain never accumulates rejections.
		this.queues.set(
			providerId,
			run.then(
				() => undefined,
				() => undefined,
			),
		);
		return run;
	}
}
