<script setup lang="ts">
import { computed, ref } from "vue"
import { ElMessage } from "element-plus"
import { useConnectionStore } from "../../stores"
import { showError } from "../../hooks/shared/useErrors"
import IconConnect from "~icons/hugeicons/plug-01"
import IconReset from "~icons/hugeicons/refresh"

const connection = useConnectionStore()

// Local editable form fields, seeded from the client's current config.
const endpoint = ref(connection.endpoint)
const token = ref(connection.token)
const saving = ref(false)

const stateLabel = computed(() => {
  switch (connection.state.connectionState) {
    case "connected":
      return "connected"
    case "connecting":
    case "reconnecting":
      return "connecting…"
    default:
      return "offline"
  }
})

const stateType = computed(() => {
  switch (connection.state.connectionState) {
    case "connected":
      return "success"
    case "connecting":
    case "reconnecting":
      return "warning"
    default:
      return "info"
  }
})

const isDefault = computed(
  () => endpoint.value === connection.endpoint && token.value === connection.token,
)

async function save(): Promise<void> {
  const ep = endpoint.value.trim()
  if (!ep) {
    ElMessage.warning("Enter an endpoint URL (ws://…/ws)")
    return
  }
  saving.value = true
  try {
    await connection.applyConnection({ endpoint: ep, token: token.value })
    ElMessage.success("Connection settings saved — reconnecting…")
  } catch (err) {
    showError(err)
  } finally {
    saving.value = false
  }
}

/** Discard edits and return the form to the currently-active config. */
function reset(): void {
  endpoint.value = connection.endpoint
  token.value = connection.token
}
</script>

<template>
  <section class="setting">
    <div class="setting-head">
      <h3>Connection</h3>
      <el-tag size="small" effect="plain" :type="stateType">
        {{ stateLabel }}
      </el-tag>
    </div>
    <p class="note">
      Configure the core server this client connects to (WebSocket endpoint and
      auth token). Saving persists the settings and reconnects immediately.
    </p>

    <div class="setting-item">
      <span class="setting-label">Endpoint</span>
      <el-input
        v-model="endpoint"
        placeholder="ws://127.0.0.1:2100/ws"
        class="endpoint-input"
      />
    </div>

    <div class="setting-item">
      <span class="setting-label">Token</span>
      <el-input
        v-model="token"
        type="password"
        show-password
        placeholder="auth token"
        class="endpoint-input"
        @keydown.enter="save"
      />
    </div>

    <div class="setting-actions">
      <el-button
        type="primary"
        :disabled="isDefault || saving"
        :loading="saving"
        :icon="IconConnect"
        @click="save"
      >
        Save &amp; reconnect
      </el-button>
      <el-button
        text
        :disabled="isDefault || saving"
        :icon="IconReset"
        @click="reset"
      >
        Discard
      </el-button>
    </div>
  </section>
</template>

<style scoped>
.setting {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px;
  background: var(--bg-panel);
}
.setting-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
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
.endpoint-input {
  flex: 1;
  min-width: 240px;
  max-width: 480px;
}
.setting-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
