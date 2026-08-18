<script setup lang="ts">
import ChatView from "../components/ChatView.vue"
import DraftChat from "../components/DraftChat.vue"
import { useActiveChat } from "../hooks/chat/useActiveChat"

const { activeSessionId, isDraft } = useActiveChat()
</script>

<template>
  <DraftChat v-if="isDraft" :draft-id="activeSessionId" />
  <ChatView
    v-else-if="activeSessionId"
    :key="activeSessionId"
    :session-id="activeSessionId"
  />
  <div v-else class="empty-state">
    <el-empty description="Select or create a session to start chatting." :image-size="96" />
  </div>
</template>

<style scoped>
.empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
