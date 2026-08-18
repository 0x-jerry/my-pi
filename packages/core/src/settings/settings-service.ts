import { SettingsRepo } from "../db/repos";
import {
	getSettingSchema,
	SettingsValidationError,
	type AllSettings,
	type SettingKey,
	type SettingValue,
} from "./settings-schema";

export class SettingsService {
	constructor(private repo: SettingsRepo) {}

	/**
	 * Read a setting. The value is validated against the key's schema; an
	 * unknown key, corrupt stored JSON, or a stored value that no longer
	 * matches its schema throws (strict reads).
	 *
	 * Returns `undefined` when the row is absent (or `fallback` when given)
	 * and `null` for a stored-but-cleared value.
	 */
	get<K extends SettingKey>(key: K): SettingValue<K> | undefined;
	get<K extends SettingKey>(
		key: K,
		fallback: SettingValue<K> | null,
	): SettingValue<K> | null;
	get(key: string, fallback?: unknown): unknown;
	get(key: string, fallback?: unknown): unknown {
		const schema = getSettingSchema(key);
		if (!schema) {
			throw new SettingsValidationError(`Unknown settings key: "${key}"`);
		}
		const row = this.repo.get(key);
		if (!row) {
			// Absent row: return the fallback — but only if it's actually valid
			// for this key. A bogus fallback (e.g. sent as `any` over RPC) must
			// not slip past the schema.
			if (fallback === undefined) return undefined;
			const fb = schema.safeParse(fallback);
			if (!fb.success) {
				const issues = fb.error.issues.map((i) => i.message).join("; ");
				throw new SettingsValidationError(
					`Invalid fallback for settings key "${key}": ${issues}`,
				);
			}
			return fb.data;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(row.valueJson);
		} catch {
			throw new SettingsValidationError(
				`Corrupt stored value for settings key "${key}"`,
			);
		}
		const result = schema.safeParse(parsed);
		if (!result.success) {
			throw new SettingsValidationError(
				`Stored value for settings key "${key}" is invalid`,
			);
		}
		return result.data;
	}

	/**
	 * Write a setting. The key must be in the closed settings map and the
	 * value must match the key's schema, otherwise SettingsValidationError is
	 * thrown and nothing is written. `null` clears the setting (stored as JSON
	 * `null`; get returns `null`).
	 */
	set<K extends SettingKey>(key: K, value: SettingValue<K>): void;
	set(key: string, value: unknown): void;
	set(key: string, value: unknown): void {
		const schema = getSettingSchema(key);
		if (!schema) {
			throw new SettingsValidationError(`Unknown settings key: "${key}"`);
		}
		const result = schema.safeParse(value);
		if (!result.success) {
			const issues = result.error.issues
				.map((i) => i.message)
				.join("; ");
			throw new SettingsValidationError(
				`Invalid value for settings key "${key}": ${issues}`,
			);
		}
		this.repo.set(key, JSON.stringify(result.data));
	}

	/**
	 * Snapshot of every stored setting, keyed by the closed settings map.
	 * Unlike `get`, this is a tolerant bulk read: rows for unknown keys are
	 * ignored, and rows whose stored JSON is corrupt or no longer matches
	 * their schema are skipped rather than rejected, so one stale row can't
	 * brick a whole settings load. A stored-but-cleared value stays `null`.
	 */
	all(): AllSettings {
		// Values are validated per key by their own schema; the final cast only
		// recovers the per-key value types from the runtime keyed collection.
		const out: Partial<Record<SettingKey, unknown>> = {};
		for (const row of this.repo.all()) {
			const schema = getSettingSchema(row.key);
			if (!schema) continue; // not a managed setting
			let parsed: unknown;
			try {
				parsed = JSON.parse(row.valueJson);
			} catch {
				continue; // torn write; skip
			}
			const result = schema.safeParse(parsed);
			if (!result.success) continue; // stale value; skip
			out[row.key as SettingKey] = result.data;
		}
		return out as AllSettings;
	}
}
