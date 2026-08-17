<script setup lang="ts">
import { computed, ref } from "vue"
import { ElMessage, ElMessageBox } from "element-plus"
import type { PluginInfo, ProviderInfo, ThinkingLevel } from "@my-pi/shared"
import ModelPicker from "../components/ModelPicker.vue"
import IconCheck from "~icons/hugeicons/checkmark-circle-01"
import IconLogin from "~icons/hugeicons/login-01"
import IconLogout from "~icons/hugeicons/logout-01"
import IconPlus from "~icons/hugeicons/plus-sign"
import IconDelete from "~icons/hugeicons/delete-01"
import { useStore } from "../store"

const store = useStore()

// ---- app settings ----

const THINKING_LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]

// el-select can't hold undefined as a selectable option value — the "default"
// choice is a sentinel string mapped to undefined at the API edge.
const THINKING_DEFAULT = "__default__"

const model = ref<{ provider: string; id: string } | null>(
  (store.state.settings.defaultModel as { provider: string; id: string } | undefined) ?? null,
)
const thinking = ref<string>(
  (store.state.settings.defaultThinkingLevel as ThinkingLevel | undefined) ??
    THINKING_DEFAULT,
)
const saving = ref(false)

async function saveModel() {
  if (!model.value) return
  saving.value = true
  try {
    await store.setDefaultModel(model.value)
    ElMessage.success("Default model saved")
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  } finally {
    saving.value = false
  }
}

async function saveThinking() {
  if (thinking.value === THINKING_DEFAULT) return
  saving.value = true
  try {
    await store.setDefaultThinkingLevel(thinking.value as ThinkingLevel)
    ElMessage.success("Thinking level saved")
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  } finally {
    saving.value = false
  }
}

// ---- auth ----

const providerKey = ref<Record<string, string>>({})
const authBusy = ref<Record<string, boolean>>({})
const authError = ref<Record<string, string | null>>({})

// Providers are refreshed on connect/reconnect, so mirror store state.
const providers = computed(() => store.state.providers)

function authStatus(p: ProviderInfo): string {
  return p.authConfigured ? "configured" : "not configured"
}

async function login(p: ProviderInfo) {
  const apiKey = (providerKey.value[p.id] ?? "").trim()
  if (!apiKey) {
    ElMessage.warning("Enter an API key first")
    return
  }
  authBusy.value[p.id] = true
  authError.value[p.id] = null
  try {
    await store.loginApiKey(p.id, apiKey)
    providerKey.value[p.id] = "" // never carry the key across logins
    ElMessage.success(`${p.name} authenticated`)
  } catch (err) {
    authError.value[p.id] = err instanceof Error ? err.message : String(err)
  } finally {
    authBusy.value[p.id] = false
  }
}

async function logout(p: ProviderInfo) {
  authBusy.value[p.id] = true
  authError.value[p.id] = null
  try {
    await store.logout(p.id)
    ElMessage.success(`${p.name} logged out`)
  } catch (err) {
    authError.value[p.id] = err instanceof Error ? err.message : String(err)
  } finally {
    authBusy.value[p.id] = false
  }
}

// ---- plugins ----

const path = ref("")
const scope = ref<"global" | "workspace">("global")
const adding = ref(false)

const globalPlugins = computed(() =>
  store.state.pluginsGlobal.filter((p) => p.scope === "global"),
)
const workspacePlugins = computed(() => {
  const wsId = store.state.activeWorkspaceId
  return wsId
    ? (store.state.pluginsWorkspace[wsId] ?? []).filter((p) => p.scope === "workspace")
    : []
})

async function addPlugin() {
  if (!path.value.trim()) {
    ElMessage.warning("Plugin path is required")
    return
  }
  adding.value = true
  try {
    await store.addPlugin({
      source: path.value.trim(),
      scope: scope.value,
      workspaceId:
        scope.value === "workspace" ? (store.state.activeWorkspaceId ?? undefined) : undefined,
    })
    path.value = ""
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  } finally {
    adding.value = false
  }
}

async function togglePlugin(p: PluginInfo, enabled: boolean) {
  try {
    await store.setPluginEnabled(p.id, enabled)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}

function onToggleSwitch(p: PluginInfo, value: unknown) {
  void togglePlugin(p, Boolean(value))
}

async function removePlugin(p: PluginInfo) {
  try {
    await ElMessageBox.confirm(`Remove plugin "${p.name}"?`, "Remove plugin", {
      type: "warning",
      confirmButtonText: "Remove",
      cancelButtonText: "Cancel",
    })
  } catch {
    return // dismissed
  }
  try {
    await store.removePlugin(p.id)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}
</script>

<template>
  <section class="page">
    <h2 class="page-title">Settings</h2>

    <!-- Auth -->
    <div class="setting">
      <h3>Authentication</h3>
      <p class="note">
        Configure provider credentials so models can be used. Each provider is
        authenticated independently.
      </p>
      <div class="auth-list">
        <div v-for="p in providers" :key="p.id" class="auth-row">
          <div class="auth-info">
            <span class="auth-name">{{ p.name }}</span>
            <el-tag
              size="small"
              effect="plain"
              :type="p.authConfigured ? 'success' : 'info'"
            >
              {{ authStatus(p) }}
            </el-tag>
          </div>
          <div class="auth-controls">
            <el-input
              v-model="providerKey[p.id]"
              type="password"
              show-password
              placeholder="API key (sk-…)"
              class="auth-key"
              :disabled="p.authConfigured"
              @keydown.enter="login(p)"
            />
            <el-button
              type="primary"
              :disabled="p.authConfigured || !providerKey[p.id]"
              :loading="authBusy[p.id]"
              :icon="IconLogin"
              @click="login(p)"
            >
              Login
            </el-button>
            <el-button
              :disabled="!p.authConfigured"
              text
              :loading="authBusy[p.id]"
              :icon="IconLogout"
              @click="logout(p)"
            >
              Logout
            </el-button>
          </div>
          <el-alert
            v-if="authError[p.id]"
            type="error"
            :closable="false"
            show-icon
            class="auth-err"
          >
            {{ authError[p.id] }}
          </el-alert>
        </div>
        <p v-if="providers.length === 0" class="note">No providers available.</p>
      </div>
    </div>

    <!-- App settings -->
    <div class="setting">
      <h3>Defaults</h3>
      <p class="note">Defaults used when creating new sessions.</p>

      <div class="setting-item">
        <span class="setting-label">Default model</span>
        <ModelPicker v-model="model" />
        <el-button
          type="primary"
          :disabled="!model || saving"
          :icon="IconCheck"
          @click="saveModel"
        >
          Save default model
        </el-button>
      </div>

      <div class="setting-item">
        <span class="setting-label">Default thinking level</span>
        <el-select v-model="thinking" class="level-select" filterable>
          <el-option label="— default —" :value="THINKING_DEFAULT" />
          <el-option v-for="l in THINKING_LEVELS" :key="l" :label="l" :value="l" />
        </el-select>
        <el-button
          type="primary"
          :disabled="thinking === THINKING_DEFAULT || saving"
          :icon="IconCheck"
          @click="saveThinking"
        >
          Save thinking level
        </el-button>
      </div>
    </div>

    <!-- Plugins -->
    <div class="setting">
      <h3>Plugins</h3>
      <p class="note">
        Enabling/disabling applies to sessions loaded <strong>after</strong> the
        toggle — restart the session (send a message again) to pick up changes.
      </p>

      <form class="plugin-add" @submit.prevent="addPlugin">
        <el-input v-model="path" placeholder="/absolute/path/to/plugin" clearable />
        <el-select v-model="scope" class="scope-select">
          <el-option label="global" value="global" />
          <el-option label="workspace" value="workspace" />
        </el-select>
        <el-button type="primary" native-type="submit" :loading="adding">
          <el-icon v-if="!adding"><IconPlus /></el-icon>
          <span>{{ adding ? "Adding…" : "Add by path" }}</span>
        </el-button>
      </form>

      <div class="plugin-groups">
        <div class="group">
          <h4>Global</h4>
          <ul class="plist">
            <li v-for="p in globalPlugins" :key="p.id">
              <span class="pname">{{ p.name }}</span>
              <span class="psrc">{{ p.source }}</span>
              <span class="pdesc">{{ p.description }}</span>
              <el-switch
                :model-value="p.enabled"
                inline-prompt
                active-text="on"
                inactive-text="off"
                class="pswitch"
                @change="onToggleSwitch(p, $event)"
              />
              <el-tooltip content="Remove plugin" placement="top">
                <el-button
                  text
                  circle
                  class="pdel"
                  :icon="IconDelete"
                  @click="removePlugin(p)"
                />
              </el-tooltip>
            </li>
            <li v-if="globalPlugins.length === 0" class="empty">—</li>
          </ul>
        </div>

        <div v-if="store.state.activeWorkspaceId" class="group">
          <h4>Workspace ({{ store.state.activeWorkspaceId.slice(0, 8) }})</h4>
          <ul class="plist">
            <li v-for="p in workspacePlugins" :key="p.id">
              <span class="pname">{{ p.name }}</span>
              <span class="psrc">{{ p.source }}</span>
              <span class="pdesc">{{ p.description }}</span>
              <el-switch
                :model-value="p.enabled"
                inline-prompt
                active-text="on"
                inactive-text="off"
                class="pswitch"
                @change="onToggleSwitch(p, $event)"
              />
              <el-tooltip content="Remove plugin" placement="top">
                <el-button
                  text
                  circle
                  class="pdel"
                  :icon="IconDelete"
                  @click="removePlugin(p)"
                />
              </el-tooltip>
            </li>
            <li v-if="workspacePlugins.length === 0" class="empty">—</li>
          </ul>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.page {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 760px;
}
.page-title {
  margin: 0;
  font-size: 17px;
}
.setting {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px;
  background: var(--bg-panel);
}
.setting h3 {
  margin: 0;
  font-size: 15px;
}
.note {
  color: var(--fg-dim);
  font-size: 12px;
  margin: 0;
}
.setting-item {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.setting-label {
  min-width: 150px;
  color: var(--fg);
  font-size: 13px;
}
.level-select {
  width: 200px;
}

/* auth */
.auth-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.auth-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px;
}
.auth-info {
  display: flex;
  align-items: center;
  gap: 8px;
}
.auth-name {
  font-weight: 600;
  font-size: 13px;
}
.auth-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.auth-key {
  width: 260px;
  max-width: 100%;
}
.auth-err {
  margin: 0;
}

/* plugins */
.plugin-add {
  display: flex;
  gap: 8px;
  align-items: center;
}
.plugin-add :deep(.el-input) {
  flex: 1;
}
.scope-select {
  width: 140px;
}
.plugin-groups {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.group h4 {
  font-size: 13px;
  color: var(--fg-dim);
  margin: 0 0 6px;
}
.plist {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.plist li {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 4px 10px;
  align-items: center;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 10px;
}
.pname {
  font-weight: 600;
  font-size: 13px;
}
.psrc {
  grid-column: 1;
  color: var(--fg-dim);
  font-size: 11px;
  word-break: break-all;
}
.pdesc {
  grid-column: 1;
  color: var(--fg-dim);
  font-size: 12px;
}
.pswitch {
  grid-column: 2;
  grid-row: 1;
}
.pdel {
  grid-column: 3;
  grid-row: 1;
  color: var(--fg-dim);
}
.pdel:hover {
  color: var(--danger);
}
.empty {
  color: var(--fg-dim);
  font-size: 12px;
}
</style>
