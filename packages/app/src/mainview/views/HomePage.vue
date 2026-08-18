<script setup lang="ts">
import WorkspaceTree from "../components/WorkspaceTree.vue"
import ChatPage from "./ChatPage.vue"
import { useSessionStore } from "../stores"

const sessions = useSessionStore()
</script>

<template>
  <div class="home">
    <WorkspaceTree />
    <main v-if="sessions.state.activeWorkspaceId" class="content">
      <ChatPage />
    </main>
    <div v-else class="no-workspace">
      <el-empty
        description="Open a workspace on the left, or add one to begin."
        :image-size="96"
      />
    </div>
  </div>
</template>

<style scoped>
.home {
  flex: 1;
  display: flex;
  min-width: 0;
}
.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.no-workspace {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
