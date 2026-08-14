import type { AppEvent } from "@my-pi/shared";

type Listener = (event: never) => void;

/**
 * Minimal typed pub/sub keyed by event type. Both persistence and the
 * notification broadcaster subscribe here.
 */
export class EventBus {
	private listeners = new Map<string, Set<Listener>>();

	on<K extends AppEvent["type"]>(
		type: K,
		listener: (event: Extract<AppEvent, { type: K }>) => void,
	): () => void {
		let set = this.listeners.get(type);
		if (!set) {
			set = new Set<Listener>();
			this.listeners.set(type, set);
		}
		const wrapped = listener as Listener;
		set.add(wrapped);
		return () => {
			set.delete(wrapped);
		};
	}

	emit<E extends AppEvent>(event: E): void {
		const set = this.listeners.get(event.type);
		if (!set) return;
		for (const listener of [...set]) (listener as (e: E) => void)(event);
	}
}
