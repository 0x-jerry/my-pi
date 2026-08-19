<script setup lang="ts">
import { computed } from "vue"
import type { StoredMessage } from "@my-pi/shared"
import { messageError, renderStoredMessage } from "../../utils/render"
import { fmtMsgUsage } from "../../utils/format"
import IconFork from "~icons/hugeicons/fork"
import MessageBlock from "./MessageBlock.vue"

const props = defineProps<{ msg: StoredMessage }>()
const emit = defineEmits<{ (e: "forkHere", msg: StoredMessage): void }>()

const blocks = computed(() => renderStoredMessage(props.msg))
const error = computed(() => messageError(props.msg))
const label = computed(() => [props.msg.provider, props.msg.model].filter(Boolean).join(" / "))
</script>

<template>
  <article class="msg" :class="msg.role">
    <div class="msg-meta">
      <span class="msg-role">{{ msg.role }}</span>
    </div>

    <div class="msg-body">
      <MessageBlock
        v-for="(block, i) in blocks"
        :key="`${msg.id}-${i}`"
        :block="block"
      />
      <p v-if="error" class="msg-error">{{ error }}</p>
    </div>

    <div class="msg-foot">
      <span v-if="label" class="msg-model">{{ label }}</span>
      <span v-if="msg.usage" class="msg-usage">{{ fmtMsgUsage(msg.usage) }}</span>
      <el-tooltip content="Fork here" placement="top">
        <el-button
          text
          circle
          size="small"
          class="fork-here"
          :icon="IconFork"
          aria-label="Fork here"
          @click="emit('forkHere', msg)"
        />
      </el-tooltip>
    </div>
  </article>
</template>

<style scoped>
.msg {
  max-width: 820px;
  align-self: flex-start;
  min-width: 0;
}
.msg.user {
  align-self: flex-end;
}
.msg.user :deep(.comark-content) {
  background: var(--bg-user);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 8px 12px;
}
.msg-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
}
.msg-role {
  font-size: 11px;
  text-transform: uppercase;
  color: var(--fg-dim);
  font-weight: 600;
}
.msg-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}
.msg.user .msg-foot {
  justify-content: flex-end;
}
.msg-model {
  font-size: 11px;
  color: var(--fg-dim);
}
.msg-usage {
  font-size: 11px;
  color: var(--fg-dim);
}
.fork-here {
  padding: 0;
  height: auto;
}
.msg-error {
  color: var(--danger);
  font-size: 12px;
  margin: 4px 0 0;
}
</style>
