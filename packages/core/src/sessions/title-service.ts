import { ModelService } from "@my-pi/agent";
import { DEFAULT_SESSION_TITLE, type CoreEvent, type StoredMessage } from "@my-pi/shared";
import { EventBus } from "../events/event-bus";
import { SessionService } from "./session-service";
import { SettingsService } from "../settings/settings-service";

/** Hard cap so a model can never produce an absurdly long title. */
const MAX_TITLE_LEN = 80;

/** Abort a stuck titling call so it can't hang (and re-trigger) forever. */
const TITLING_TIMEOUT_MS = 10_000;

const TITLING_SYSTEM_PROMPT =
	"You are a helpful assistant that names chat sessions. " +
	"Reply with ONLY the title: a short, descriptive phrase of at most 60 characters. " +
	"No quotes, no leading or trailing punctuation, no explanation.";

/** Extract plain text from an opaque pi content value (string or parts). */
function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const part of content) {
		if (typeof part === "string") {
			parts.push(part);
		} else if (part && typeof part === "object") {
			const text = (part as { text?: unknown }).text;
			if (typeof text === "string") parts.push(text);
		}
	}
	return parts.join(" ").trim();
}

/** First user prompt in a persisted transcript, or "" when absent/opaque. */
function firstUserText(messages: StoredMessage[]): string {
	for (const m of messages) {
		if (m.role !== "user") continue;
		const text = extractText((m.data as { content?: unknown } | null)?.content);
		if (text) return text;
	}
	return "";
}

/** Clean up the model's reply into a usable title. */
function sanitizeTitle(raw: string): string {
	let title = raw.trim();
	// Strip one pair of surrounding quotes.
	if (
		title.length >= 2 &&
		((title.startsWith('"') && title.endsWith('"')) ||
			(title.startsWith("'") && title.endsWith("'")))
	) {
		title = title.slice(1, -1).trim();
	}
	// Collapse whitespace/newlines, drop trailing punctuation.
	title = title.replace(/\s+/g, " ").replace(/[.。!！?？]+$/, "").trim();
	return title.slice(0, MAX_TITLE_LEN);
}

/**
 * One-shot LLM titling for draft-created sessions. Subscribes to
 * `session.run_end` (emitted by the persistence writer AFTER storage) and,
 * for sessions created via the + draft flow (autoTitle) that still carry the
 * default DEFAULT_SESSION_TITLE title, asks the model to name the session from its
 * first user message. Fire-and-forget: failures are logged and never affect
 * the run.
 */
export class TitleService {
	constructor(
		private bus: EventBus,
		private sessions: SessionService,
		private settings: SettingsService,
		private modelService: ModelService,
	) {}

	/** Sessions with a titling model call currently in flight (per-session lock). */
	private inFlight = new Set<string>();

	start(): void {
		this.bus.on("session.run_end", (event) => void this.handleRunEnd(event));
	}

	private async handleRunEnd(
		event: Extract<CoreEvent, { type: "session.run_end" }>,
	): Promise<void> {
		try {
			// One-shot: only draft-created sessions with the untouched default
			// title. A manual rename (or a titled session) is left alone.
			if (!this.sessions.isAutoTitleEligible(event.sessionId)) return;
			const firstPrompt = firstUserText(event.messages);
			if (!firstPrompt || event.messages.length === 0) return;

			const session = this.sessions.get(event.sessionId);
			if (session.title !== DEFAULT_SESSION_TITLE) return;

			// Titling model: explicit titleModel, else the background-task model
			// (settings.defaultModel), else fall back to the session's own model.
			const titleModel =
				this.settings.get("titleModel") ??
				this.settings.get("defaultModel") ??
				(session.modelProvider && session.modelId
					? { provider: session.modelProvider, id: session.modelId }
					: null);
			if (!titleModel) return;
			const model = this.modelService.getModel(
				titleModel.provider,
				titleModel.id,
			);
			if (!model) return;

			// Per-session lock: only one titling call at a time. A second run_end
			// for the same still-untitled draft is skipped so we don't fire two
			// billed model calls with the same first user message.
			if (this.inFlight.has(event.sessionId)) return;
			this.inFlight.add(event.sessionId);
			try {
				const reply = await this.modelService.runtime.completeSimple(
					model,
					{
						systemPrompt: TITLING_SYSTEM_PROMPT,
						messages: [
							{
								role: "user",
								content: `Name this chat session. Its first message is: "${firstPrompt}"`,
								timestamp: Date.now(),
							},
						],
					},
					// Titling is a trivial one-shot task: keep the thinking budget low,
					// and abort if the provider call hangs.
					{ reasoning: "low", signal: AbortSignal.timeout(TITLING_TIMEOUT_MS) },
				);

				const title = sanitizeTitle(
					reply.content
						.filter((c) => c.type === "text")
						.map((c) => (c as { text: string }).text)
						.join(""),
				);
				if (!title) return;

				// Re-read before writing: the user may have renamed the session (or
				// it may have been re-titled) while the model call was in flight.
				// Never clobber a manual rename.
				const fresh = this.sessions.get(event.sessionId);
				if (!this.sessions.isAutoTitleEligible(event.sessionId)) return;
				if (fresh.title !== DEFAULT_SESSION_TITLE) return;

				const updated = this.sessions.updateTitle(event.sessionId, title);
				this.bus.emit({
					type: "session.title_updated",
					sessionId: event.sessionId,
					title,
					updatedAt: updated.updatedAt,
				});
			} finally {
				this.inFlight.delete(event.sessionId);
			}
		} catch (err) {
			// Titling is best-effort; never break the run over a title.
			console.error("auto-title failed:", err);
		}
	}
}
