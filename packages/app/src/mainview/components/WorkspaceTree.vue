<script setup lang="ts">
import { computed, ref } from "vue"
import { ElMessage, ElMessageBox } from "element-plus"
import type { SessionInfo, Workspace } from "@my-pi/shared"
import { DEFAULT_SESSION_TITLE } from "@my-pi/shared"
import IconRobot from "~icons/hugeicons/robot-01"
import IconFolderAdd from "~icons/hugeicons/folder-add"
import IconFolder from "~icons/hugeicons/folder-01"
import IconFolderOpen from "~icons/hugeicons/folder-open"
import IconArrowRight from "~icons/hugeicons/arrow-right-01"
import IconArrowDown from "~icons/hugeicons/arrow-down-01"
import IconPlus from "~icons/hugeicons/plus-sign"
import IconFork from "~icons/hugeicons/fork"
import IconDelete from "~icons/hugeicons/delete-01"
import { useStore } from "../store"

const store = useStore()

const adding = ref(false)

/** Local placeholder nodes of the expanded (active) workspace. */
const drafts = computed(() =>
  store.state.drafts.filter((d) => d.workspaceId === store.state.activeWorkspaceId),
)

function showError(err: unknown) {
  ElMessage.error(err instanceof Error ? err.message : String(err))
}

/** Last path segment of a folder, e.g. "/home/u/code/x" → "x". */
function folderName(dir: string): string {
  const trimmed = dir.replace(/[\\/]+$/, "")
  const base = trimmed.split(/[\\/]/).pop()
  return base && base !== trimmed ? base : dir
}

/**
 * Add a workspace: open the shell's native folder picker, then create the
 * workspace for the chosen directory (name defaults to the folder name).
 */
async function add() {
  if (adding.value) return
  adding.value = true
  try {
    const dir = await store.pickFolder()
    if (!dir) return // dialog dismissed
    await store.createWorkspace(folderName(dir), dir)
  } catch (err) {
    showError(err)
  } finally {
    adding.value = false
  }
}

async function open(ws: Workspace) {
  try {
    await store.openWorkspace(ws.id)
  } catch (err) {
    showError(err)
  }
}

async function remove(ws: Workspace) {
  try {
    await ElMessageBox.confirm(
      `Remove workspace "${ws.name}"?\nAll sessions and messages will be deleted.`,
      "Remove workspace",
      {
        type: "warning",
        confirmButtonText: "Remove",
        cancelButtonText: "Cancel",
      },
    )
  } catch {
    return // dismissed
  }
  try {
    await store.removeWorkspace(ws.id)
  } catch (err) {
    showError(err)
  }
}

/**
 * Start a new session: the + icon adds a local "New session" placeholder node
 * and opens its composer. The real session is created server-side only when
 * the first message is sent (see store.sendDraft).
 */
async function newSession(ws: Workspace) {
  if (store.state.activeWorkspaceId !== ws.id) {
    try {
      await store.openWorkspace(ws.id)
    } catch (err) {
      showError(err)
      return
    }
  }
  store.openDraft(store.startDraft(ws.id))
}

async function openSession(s: SessionInfo) {
  try {
    await store.openSession(s.id)
  } catch (err) {
    showError(err)
  }
}

async function fork(s: SessionInfo) {
  try {
    const forked = await store.forkSession(s.id)
    await store.openSession(forked.id)
  } catch (err) {
    showError(err)
  }
}

async function removeSession(s: SessionInfo) {
  try {
    await ElMessageBox.confirm(`Delete session "${s.title}"?`, "Delete session", {
      type: "warning",
      confirmButtonText: "Delete",
      cancelButtonText: "Cancel",
    })
  } catch {
    return // dismissed
  }
  try {
    await store.deleteSession(s.id)
  } catch (err) {
    showError(err)
  }
}

function statusDot(s: SessionInfo): string {
  switch (s.status) {
    case "running":
      return "dot-running"
    case "error":
      return "dot-error"
    default:
      return "dot-idle"
  }
}
</script>

<template>
  <aside class="sidebar">
    <h1 class="brand">
      <el-icon class="brand-icon"><IconRobot /></el-icon>
      <span>my-pi</span>
    </h1>

    <el-button
      type="primary"
      class="add-btn"
      :loading="adding"
      :icon="IconFolderAdd"
      @click="add"
    >
      {{ adding ? "Adding…" : "Add workspace" }}
    </el-button>

    <ul class="tree">
      <li v-for="ws in store.state.workspaces" :key="ws.id" class="ws-node">
        <div
          class="ws-row"
          :class="{ active: store.state.activeWorkspaceId === ws.id }"
          @click="open(ws)"
        >
          <el-icon class="chevron">
            <IconArrowDown v-if="store.state.activeWorkspaceId === ws.id" />
            <IconArrowRight v-else />
          </el-icon>
          <el-icon class="ws-icon">
            <IconFolderOpen v-if="store.state.activeWorkspaceId === ws.id" />
            <IconFolder v-else />
          </el-icon>
          <span class="ws-name">{{ ws.name }}</span>
          <span class="ws-actions">
            <el-tooltip content="New session" placement="top">
              <el-button
                class="icon-btn"
                text
                circle
                :icon="IconPlus"
                aria-label="New session"
                @click.stop="newSession(ws)"
              />
            </el-tooltip>
            <el-tooltip content="Remove workspace" placement="top">
              <el-button
                class="icon-btn danger"
                text
                circle
                :icon="IconDelete"
                aria-label="Remove workspace"
                @click.stop="remove(ws)"
              />
            </el-tooltip>
          </span>
        </div>

        <ul v-if="store.state.activeWorkspaceId === ws.id" class="children">
          <li v-for="d in drafts" :key="d.localId" class="session-row draft">
            <button
              class="session"
              :class="{ active: store.state.activeSessionId === d.localId }"
              @click="store.openDraft(d.localId)"
            >
              <span class="dot dot-draft" />
              <span class="title">{{ DEFAULT_SESSION_TITLE }}</span>
            </button>
            <el-tooltip content="Discard draft" placement="top">
              <el-button
                class="icon-btn danger"
                text
                circle
                :icon="IconDelete"
                aria-label="Discard draft"
                @click="store.discardDraft(d.localId)"
              />
            </el-tooltip>
          </li>

          <li v-for="s in store.state.sessions" :key="s.id" class="session-row">
            <button
              class="session"
              :class="{ active: store.state.activeSessionId === s.id }"
              @click="openSession(s)"
            >
              <span class="dot" :class="statusDot(s)" />
              <span class="title">{{ s.title }}</span>
            </button>
            <span class="session-actions">
              <el-tooltip content="Fork session" placement="top">
                <el-button class="icon-btn" text circle :icon="IconFork" @click="fork(s)" />
              </el-tooltip>
              <el-tooltip content="Delete session" placement="top">
                <el-button
                  class="icon-btn danger"
                  text
                  circle
                  :icon="IconDelete"
                  @click="removeSession(s)"
                />
              </el-tooltip>
            </span>
          </li>

          <li
            v-if="store.state.sessions.length === 0 && drafts.length === 0"
            class="empty"
          >
            No sessions yet — click + to start one.
          </li>
        </ul>
      </li>

      <li v-if="store.state.workspaces.length === 0" class="empty">
        <el-empty description="No workspaces yet — add a directory above." :image-size="72" />
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 280px;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  overflow-y: auto;
  background: var(--bg-panel);
}
.brand {
  margin: 0;
  font-size: 18px;
  letter-spacing: 0.02em;
  display: flex;
  align-items: center;
  gap: 8px;
}
.brand-icon {
  color: var(--accent);
  font-size: 20px;
}
.add-btn {
  width: 100%;
}
.tree {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ws-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  color: var(--fg);
}
.ws-row:hover {
  background: var(--bg-hover);
}
.ws-row.active {
  border-color: var(--accent);
  background: var(--bg-active);
}
.chevron {
  flex-shrink: 0;
  color: var(--fg-dim);
  font-size: 12px;
}
.ws-icon {
  flex-shrink: 0;
  color: var(--warn);
  font-size: 16px;
}
.ws-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
  font-size: 13px;
}
.ws-actions {
  display: none;
  gap: 2px;
  align-items: center;
}
.ws-row:hover .ws-actions,
.ws-row.active .ws-actions {
  display: inline-flex;
}
.children {
  list-style: none;
  margin: 2px 0 4px;
  padding: 0 0 0 26px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.session-row {
  display: flex;
  align-items: center;
  gap: 2px;
  border-radius: 6px;
}
.session-row:hover {
  background: var(--bg-hover);
}
.session {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--fg);
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
  text-align: left;
}
.session.active {
  background: var(--bg-active);
}
.session.active .title {
  color: var(--accent);
}
.title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.dot-running {
  background: var(--ok);
}
.dot-error {
  background: var(--danger);
}
.dot-idle {
  background: var(--fg-dim);
}
/* Draft placeholder: dashed ring, italic title. */
.session-row.draft .dot {
  background: transparent;
  border: 1.5px dashed var(--fg-dim);
}
.session-row.draft .title {
  font-style: italic;
  color: var(--fg-dim);
}
.session-actions {
  display: none;
  gap: 2px;
  align-items: center;
  padding-right: 4px;
}
.session-row:hover .session-actions {
  display: inline-flex;
}
.session-row.draft {
  padding-right: 4px;
}
.icon-btn {
  color: var(--fg-dim);
}
.icon-btn.danger:hover {
  color: var(--danger);
}
.empty {
  color: var(--fg-dim);
  font-size: 12px;
  list-style: none;
  padding: 4px 8px;
}
</style>
