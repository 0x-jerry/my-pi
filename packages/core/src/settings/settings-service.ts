import { SettingsRepo } from "../db/repos";

export class SettingsService {
	constructor(private repo: SettingsRepo) {}

	get<T = unknown>(key: string, fallback?: T): T | undefined {
		const row = this.repo.get(key);
		if (!row) return fallback;
		try {
			return JSON.parse(row.valueJson) as T;
		} catch {
			// Corrupt/partially-written stored JSON: treat as missing rather than
			// failing every settings read.
			return fallback;
		}
	}

	set(key: string, value: unknown): void {
		this.repo.set(key, JSON.stringify(value));
	}
}
