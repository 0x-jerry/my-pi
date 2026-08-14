import { randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";
import { existsSync, statSync } from "node:fs";
import type { CreateWorkspaceInput, Workspace } from "@my-pi/shared";
import { WorkspacesRepo, type WorkspaceRow } from "../db/repos";

function toWorkspace(row: WorkspaceRow): Workspace {
	return {
		id: row.id,
		name: row.name,
		path: row.path,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export class WorkspaceService {
	constructor(private repo: WorkspacesRepo) {}

	create(input: CreateWorkspaceInput): Workspace {
		const path = resolve(input.path);
		if (!existsSync(path) || !statSync(path).isDirectory()) {
			throw new Error(`Not a directory: ${input.path}`);
		}
		const now = Date.now();
		const row: WorkspaceRow = {
			id: randomUUID(),
			name: input.name.trim() || basename(path),
			path,
			createdAt: now,
			updatedAt: now,
		};
		try {
			this.repo.insert(row);
		} catch {
			throw new Error(`Workspace already exists for path: ${path}`);
		}
		return toWorkspace(row);
	}

	list(): Workspace[] {
		return this.repo.all().map(toWorkspace);
	}

	get(id: string): Workspace {
		const row = this.repo.byId(id);
		if (!row) throw new Error(`Workspace not found: ${id}`);
		return toWorkspace(row);
	}

	byPath(path: string): Workspace | null {
		const row = this.repo.byPath(path);
		return row ? toWorkspace(row) : null;
	}

	remove(id: string): void {
		this.repo.remove(id);
	}
}
