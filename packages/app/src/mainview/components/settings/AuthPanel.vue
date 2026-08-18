<script setup lang="ts">
import { computed, reactive } from "vue"
import { ElMessage } from "element-plus"
import type { ProviderInfo } from "@my-pi/shared"
import { useAuth } from "../../hooks/settings/useAuth"
import { useModelStore } from "../../stores"
import IconLogin from "~icons/hugeicons/login-01"
import IconLogout from "~icons/hugeicons/logout-01"

const { busy, error, login, logout } = useAuth()
const modelStore = useModelStore()
const providers = computed(() => modelStore.state.providers)
const keys = reactive<Record<string, string>>({})

function authStatus(p: ProviderInfo): string {
  return p.authConfigured ? "configured" : "not configured"
}

async function onLogin(p: ProviderInfo): Promise<void> {
  const apiKey = (keys[p.id] ?? "").trim()
  if (!apiKey) {
    ElMessage.warning("Enter an API key first")
    return
  }
  if (await login(p.id, apiKey)) {
    keys[p.id] = "" // never carry the key across logins
    ElMessage.success(`${p.name} authenticated`)
  }
  // failures are surfaced via the per-provider auth.error row
}

async function onLogout(p: ProviderInfo): Promise<void> {
  if (await logout(p.id)) {
    keys[p.id] = "" // never carry a key across logins/logouts
    ElMessage.success(`${p.name} logged out`)
  }
}
</script>

<template>
  <section class="setting">
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
            v-model="keys[p.id]"
            type="password"
            show-password
            placeholder="API key (sk-…)"
            class="auth-key"
            :disabled="p.authConfigured"
            @keydown.enter="onLogin(p)"
          />
          <el-button
            type="primary"
            :disabled="p.authConfigured || !keys[p.id]"
            :loading="busy[p.id]"
            :icon="IconLogin"
            @click="onLogin(p)"
          >
            Login
          </el-button>
          <el-button
            :disabled="!p.authConfigured"
            text
            :loading="busy[p.id]"
            :icon="IconLogout"
            @click="onLogout(p)"
          >
            Logout
          </el-button>
        </div>
        <el-alert
          v-if="error[p.id]"
          type="error"
          :closable="false"
          show-icon
          class="auth-err"
        >
          {{ error[p.id] }}
        </el-alert>
      </div>
      <p v-if="providers.length === 0" class="note">No providers available.</p>
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
.setting h3 {
  margin: 0;
  font-size: 15px;
}
.note {
  color: var(--fg-dim);
  font-size: 12px;
  margin: 0;
}
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
</style>
