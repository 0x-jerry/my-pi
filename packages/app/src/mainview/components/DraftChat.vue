<script setup lang="ts">
import { ref } from "vue"
import { ElMessage } from "element-plus"
import { DEFAULT_SESSION_TITLE } from "@my-pi/shared"
import IconTelegram from "~icons/hugeicons/telegram"
import { useStore } from "../store"

const props = defineProps<{ draftId: string | null }>()

const store = useStore()

const input = ref("")
const sending = ref(false)

async function send() {
  const text = input.value.trim()
  if (!text || sending.value || !props.draftId) return
  sending.value = true
  input.value = ""
  try {
    // Creates the real session (auto-titled after this run), opens it, and
    // sends the first prompt; ChatPage then swaps to the full ChatView.
    await store.sendDraft(props.draftId, text)
  } catch (err) {
    input.value = text
    ElMessage.error(err instanceof Error ? err.message : String(err))
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <section class="draft">
    <div class="draft-body">
      <el-empty
        description="Type a message to create this session. Its title is generated automatically."
        :image-size="80"
      >
        <template #description>
          <div class="draft-hint">
            <strong>{{ DEFAULT_SESSION_TITLE }}</strong>
            <p>Type a message to create it. Its title is generated automatically.</p>
          </div>
        </template>
      </el-empty>
    </div>

    <footer class="draft-foot">
      <div class="input-row">
        <el-input
          v-model="input"
          type="textarea"
          :autosize="{ minRows: 2, maxRows: 6 }"
          resize="none"
          placeholder="Message… (Enter to send, Shift+Enter for newline)"
          @keydown.enter.exact.prevent="send"
        />
        <el-button
          type="primary"
          :disabled="!input.trim() || sending"
          :loading="sending"
          :icon="IconTelegram"
          @click="send"
        >
          {{ sending ? "Starting…" : "Start chat" }}
        </el-button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.draft {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.draft-body {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.draft-hint {
  text-align: center;
  color: var(--fg-dim);
  font-size: 13px;
}
.draft-hint strong {
  display: block;
  color: var(--fg);
  font-size: 15px;
  margin-bottom: 6px;
}
.draft-hint p {
  margin: 0;
}
.draft-foot {
  border-top: 1px solid var(--border);
  padding: 12px;
  background: var(--bg-panel);
}
.input-row {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}
.input-row .el-input {
  flex: 1;
}
</style>
