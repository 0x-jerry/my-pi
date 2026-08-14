import { createHash, timingSafeEqual } from "node:crypto";
import type { Server, ServerWebSocket } from "bun";
import {
	parseRpcMessage,
	RpcErrorCode,
	rpcError,
	rpcSuccess,
	type JsonRpcError,
} from "@my-pi/shared";

export interface JsonRpcServerOptions {
	host?: string;
	/** 0 = pick a free port. */
	port?: number;
	/**
	 * If set, clients must present this token. Preferred transport is the
	 * WebSocket subprotocol (`new WebSocket(url, token)`), which keeps the
	 * secret out of URLs and process lists; `?token=` is accepted as a
	 * fallback. Comparisons are constant-time.
	 */
	token?: string;
	/** If set, the upgrade must carry exactly this Origin header. */
	allowedOrigin?: string;
}

type Handler = (params: any) => unknown | Promise<unknown>;

/**
 * Thrown by handlers when request params are missing or malformed; the server
 * maps it to INVALID_PARAMS (-32602) instead of INTERNAL_ERROR (-32603).
 */
export class RpcParamsError extends Error {
	constructor(message = "Invalid params") {
		super(message);
		this.name = "RpcParamsError";
	}
}

/** Constant-time string comparison (safe against length-timing too). */
function safeEqual(a: string, b: string): boolean {
	const ha = createHash("sha256").update(a).digest();
	const hb = createHash("sha256").update(b).digest();
	return timingSafeEqual(ha, hb);
}

/**
 * JSON-RPC 2.0 server over WebSocket (Bun.serve), bound to 127.0.0.1.
 * Requests are answered; client→server notifications are ignored (v1).
 * Server→client pushes use notify().
 */
export class JsonRpcServer {
	private server?: Server<undefined>;
	private sockets = new Set<ServerWebSocket>();
	private handlers = new Map<string, Handler>();

	constructor(private opts: JsonRpcServerOptions = {}) {}

	register(method: string, handler: Handler): void {
		this.handlers.set(method, handler);
	}

	/** Start listening; resolves with the actual port. */
	async start(): Promise<number> {
		if (this.server) return this.server.port!;
		const opts = this.opts;
		this.server = Bun.serve({
			hostname: opts.host ?? "127.0.0.1",
			port: opts.port ?? 0,
			fetch: (req, server) => this.handleFetch(req, server),
			websocket: {
				open: (ws) => {
					this.sockets.add(ws);
				},
				message: (ws, message) => {
					void this.handleMessage(ws, message);
				},
				close: (ws) => {
					this.sockets.delete(ws);
				},
			},
		});
		return this.server.port!;
	}

	private handleFetch(
		req: Request,
		server: Server<undefined>,
	): Response | undefined {
		const url = new URL(req.url);
		if (url.pathname !== "/ws") {
			return new Response("Not Found", { status: 404 });
		}

		const token = this.opts.token;
		const subprotocols = (req.headers.get("sec-websocket-protocol") ?? "")
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		const queryToken = url.searchParams.get("token");

		// Token via subprotocol (preferred; must be echoed for the handshake)
		// or ?token= query param (fallback).
		let echoSubprotocol: string | undefined;
		if (token) {
			if (subprotocols.length > 0) {
				echoSubprotocol = subprotocols.find((p) => safeEqual(p, token));
				if (!echoSubprotocol) {
					return new Response("Forbidden", { status: 403 });
				}
			} else if (queryToken === null || !safeEqual(queryToken, token)) {
				return new Response("Forbidden", { status: 403 });
			}
		}

		// Browsers are not subject to CORS on WebSocket handshakes, so when an
		// allowed origin is configured, require the header outright: omitting it
		// must not bypass the check (curl / native clients included).
		if (this.opts.allowedOrigin) {
			const origin = req.headers.get("origin");
			if (!origin || origin !== this.opts.allowedOrigin) {
				return new Response("Forbidden", { status: 403 });
			}
		}

		const upgraded = echoSubprotocol
			? server.upgrade(req, {
					headers: { "Sec-WebSocket-Protocol": echoSubprotocol },
				})
			: server.upgrade(req);
		if (!upgraded) return new Response("Upgrade Failed", { status: 400 });
		return undefined;
	}

	private async handleMessage(ws: ServerWebSocket, raw: string | Buffer): Promise<void> {
		const text = typeof raw === "string" ? raw : raw.toString();
		const parsed = parseRpcMessage(text);
		if (parsed.kind === "invalid") {
			this.send(ws, rpcError(null, parsed.error));
			return;
		}
		if (parsed.kind === "notification") return;

		const handler = this.handlers.get(parsed.method);
		if (!handler) {
			this.send(
				ws,
				rpcError(parsed.id, {
					code: RpcErrorCode.METHOD_NOT_FOUND,
					message: `Method not found: ${parsed.method}`,
				}),
			);
			return;
		}
		try {
			const result = await handler(parsed.params);
			this.send(ws, rpcSuccess(parsed.id, result));
		} catch (err) {
			const error: JsonRpcError = {
				code:
					err instanceof RpcParamsError
						? RpcErrorCode.INVALID_PARAMS
						: RpcErrorCode.INTERNAL_ERROR,
				message: err instanceof Error ? err.message : String(err),
			};
			this.send(ws, rpcError(parsed.id, error));
		}
	}

	/** Broadcast a server→client notification to all connected views. */
	notify(method: string, params?: unknown): void {
		if (this.sockets.size === 0) return;
		const payload = JSON.stringify({ jsonrpc: "2.0", method, params });
		for (const ws of this.sockets) ws.send(payload);
	}

	private send(ws: ServerWebSocket, payload: unknown): void {
		ws.send(JSON.stringify(payload));
	}

	async stop(): Promise<void> {
		if (!this.server) return;
		for (const ws of this.sockets) ws.close();
		this.sockets.clear();
		this.server.stop(true);
		this.server = undefined;
	}
}
