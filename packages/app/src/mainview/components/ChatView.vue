<script setup lang="ts">
import ChatHeader from "./chat/ChatHeader.vue"
import ChatMessages from "./chat/ChatMessages.vue"
import ChatComposer from "./chat/ChatComposer.vue"
import { useChatSession } from "../hooks/chat/useChatSession"

const props = defineProps<{ sessionId: string }>()

const {
  session,
  messages,
  streaming,
  running,
  usage,
  input,
  actionError,
  streamText,
  streamThinking,
  submit,
  abort,
  forkHere,
} = useChatSession(() => props.sessionId)
</script>

<template>
  <section class="chat">
    <ChatHeader :session="session" />

    <el-alert
      v-if="actionError"
      type="error"
      :closable="false"
      show-icon
      class="banner err"
    >
      {{ actionError }}
    </el-alert>
    <el-alert
      v-if="streaming.error"
      type="error"
      :closable="false"
      show-icon
      class="banner err"
    >
      {{ streaming.error }}
    </el-alert>

    <ChatMessages
      :messages="messages"
      :streaming="streaming"
      :stream-text="streamText"
      :stream-thinking="streamThinking"
      @fork-here="forkHere"
    />

    <ChatComposer
      v-model:input="input"
      :session="session"
      :usage="usage"
      :running="running"
      @submit="submit"
      @abort="abort"
    />
  </section>
</template>

<style scoped>
.chat {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100%;
}
.banner {
  margin: 8px 14px 0;
}
</style>
