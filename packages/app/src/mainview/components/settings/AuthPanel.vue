<script setup lang="ts">
import { computed, reactive, ref } from "vue"
import { ElMessage } from "element-plus"
import type { ProviderInfo } from "@my-pi/shared"
import { useAuth } from "../../hooks/settings/useAuth"
import { useModelStore } from "../../stores"
import IconLogin from "~icons/hugeicons/login-01"
import IconLogout from "~icons/hugeicons/logout-01"
import IconAdd from "~icons/hugeicons/add-circle"

const { busy, error, login, logout } = useAuth()
const modelStore = useModelStore()
const providers = computed(() => modelStore.state.providers)

const authed = computed(() => providers.value.filter((p) => p.authConfigured))
const unauthed = computed(() => providers.value.filter((p) => !p.authConfigured))

const addVisible = ref(false)
const keys = reactive<Record<string, string>>({})

function authStatus(p: ProviderInfo): string {
  return p.authConfigured ? "configured" : "not configured"
}

function openAdd(): void {
  addVisible.value = true
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
    // Once a provider is authenticated it moves from the Add dialog into the
    // main list; close when nothing is left to add.
    if (unauthed.value.length === 0) addVisible.value = false
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
    <div class="setting-head">
      <div class="setting-title">
        <h3>Authentication</h3>
        <p class="note">
          Configured providers appear here. Add a provider with a new API key
          to use its models.
        </p>
      </div>
      <el-button type="primary" :icon="IconAdd" @click="openAdd">
        Add provider
      </el-button>
    </div>

    <div class="auth-list">
      <div v-for="p in authed" :key="p.id" class="auth-row">
        <div class="auth-info">
          <span class="auth-name">{{ p.name }}</span>
          <el-tag size="small" effect="plain" type="success">
            {{ authStatus(p) }}
          </el-tag>
        </div>
        <div class="auth-controls">
          <el-alert
            v-if="error[p.id]"
            type="error"
            :closable="false"
            show-icon
            class="auth-err"
          >
            {{ error[p.id] }}
          </el-alert>
          <el-button
            text
            :loading="busy[p.id]"
            :icon="IconLogout"
            @click="onLogout(p)"
          >
            Logout
          </el-button>
        </div>
      </div>
      <p v-if="authed.length === 0" class="note">
        No configured providers yet. Use “Add provider” to authenticate one.
      </p>
    </div>

    <el-dialog
      v-model="addVisible"
      title="Add provider"
      width="480px"
      :close-on-click-modal="false"
    >
      <p class="note add-note">
        Enter an API key to authenticate a provider. Providers requiring a key
        appear here until configured.
      </p>
      <div class="auth-list">
        <div v-for="p in unauthed" :key="p.id" class="auth-row">
          <div class="auth-info">
            <span class="auth-name">{{ p.name }}</span>
            <el-tag size="small" effect="plain" type="info">
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
              @keydown.enter="onLogin(p)"
            />
            <el-button
              type="primary"
              :disabled="!keys[p.id]"
              :loading="busy[p.id]"
              :icon="IconLogin"
              @click="onLogin(p)"
            >
              Login
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
        <p v-if="unauthed.length === 0" class="note">
          All providers are authenticated.
        </p>
      </div>

      <template #footer>
        <el-button @click="addVisible = false">Close</el-button>
      </template>
    </el-dialog>
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
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.setting-title h3 {
  margin: 0;
  font-size: 15px;
}
.note {
  color: var(--fg-dim);
  font-size: 12px;
  margin: 0;
}
.add-note {
  margin-bottom: 8px;
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
