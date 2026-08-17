/**
 * App-wide constants shared across packages.
 */

/**
 * Default title of a freshly created session. Draft-created sessions (the
 * "+" flow) start with this title and are LLM-named from their first user
 * message (see TitleService / session.autoTitle). The exact string is used as
 * the "not yet auto-titled / not manually renamed" sentinel, so it must be
 * referenced everywhere via this constant rather than matched inline.
 */
export const DEFAULT_SESSION_TITLE = "New session";
