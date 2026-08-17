<script setup lang="ts">
import { computed } from "vue"
import ChatView from "../components/ChatView.vue"
import DraftChat from "../components/DraftChat.vue"
import { useStore } from "../store"

const store = useStore()

const activeSessionId = computed(() => store.state.activeSessionId)
const isDraft = computed(
  () => activeSessionId.value !== null && store.isDraft(activeSessionId.value),
)
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
