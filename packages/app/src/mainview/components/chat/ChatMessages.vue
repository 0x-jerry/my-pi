<script setup lang="ts">
import { ref } from "vue"
import type { StoredMessage } from "@my-pi/shared"
import type { StreamingState } from "../../store"
import { useStreamScroll } from "../../hooks/chat/useStreamScroll"
import MessageItem from "./MessageItem.vue"
import StreamingMessage from "./StreamingMessage.vue"

const props = defineProps<{
  messages: StoredMessage[]
  streaming: StreamingState
  streamText: string
  streamThinking: string
}>()
const emit = defineEmits<{ (e: "forkHere", msg: StoredMessage): void }>()

const scroller = ref<HTMLElement | null>(null)
useStreamScroll(
  () => [props.messages.length, props.streamText, props.streamThinking],
  scroller,
)
</script>

<template>
  <div ref="scroller" class="messages">
    <MessageItem
      v-for="msg in messages"
      :key="msg.id"
      :msg="msg"
      @fork-here="emit('forkHere', $event)"
    />

    <StreamingMessage
      :streaming="streaming"
      :stream-text="streamText"
      :stream-thinking="streamThinking"
    />

    <div
      v-if="messages.length === 0 && !streaming.pendingSend && !streamText && !streamThinking && !streaming.activeTool && streaming.parts.length === 0"
      class="empty-hint"
    >
      <el-empty description="Send a message to start the session." :image-size="80" />
    </div>
  </div>
</template>

<style scoped>
.messages {
  flex: 1;
  overflow-y: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.empty-hint {
  color: var(--fg-dim);
  text-align: center;
}
</style>
