<script setup lang="ts">
import type { UsageSummary } from "@my-pi/shared"
import { fmtUsage } from "../../utils/format"
import IconSteering from "~icons/hugeicons/steering"
import IconArrowRight from "~icons/hugeicons/arrow-right-01"
import IconStop from "~icons/hugeicons/stop"
import IconTelegram from "~icons/hugeicons/telegram"

defineProps<{
  input: string
  running: boolean
  usage?: UsageSummary | undefined
}>()
defineEmits<{
  (e: "update:input", v: string): void
  (e: "send"): void
  (e: "steer"): void
  (e: "followUp"): void
  (e: "abort"): void
}>()
</script>

<template>
  <footer class="chat-foot">
    <div class="usage">
      <template v-if="usage">last run: {{ fmtUsage(usage) }}</template>
      <template v-else>—</template>
    </div>
    <div class="input-row">
      <el-input
        :model-value="input"
        type="textarea"
        :autosize="{ minRows: 2, maxRows: 6 }"
        resize="none"
        placeholder="Message… (Enter to send, Shift+Enter for newline)"
        @update:model-value="$emit('update:input', $event)"
        @keydown.enter.exact.prevent="$emit('send')"
      />
      <div class="input-actions">
        <el-button
          :disabled="!input.trim() || running"
          :icon="IconSteering"
          @click="$emit('steer')"
        >
          Steer
        </el-button>
        <el-button
          :disabled="!input.trim() || running"
          :icon="IconArrowRight"
          @click="$emit('followUp')"
        >
          Follow-up
        </el-button>
        <el-button v-if="running" type="danger" :icon="IconStop" @click="$emit('abort')">
          Abort
        </el-button>
        <el-button
          type="primary"
          :disabled="!input.trim() || running"
          :icon="IconTelegram"
          @click="$emit('send')"
        >
          Send
        </el-button>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.chat-foot {
  border-top: 1px solid var(--border);
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--bg-panel);
}
.usage {
  color: var(--fg-dim);
  font-size: 11px;
}
.input-row {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}
.input-row :deep(.el-textarea) {
  flex: 1;
}
.input-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
</style>
