<script setup lang="ts">
import WorkspaceTree from "../components/WorkspaceTree.vue"
import ChatPage from "./ChatPage.vue"
import { useStore } from "../store"

const store = useStore()
</script>

<template>
  <div v-if="store.state.activeWorkspaceId" class="home">
    <WorkspaceTree />
    <main class="content">
      <ChatPage />
    </main>
  </div>
  <div v-else class="no-workspace">
    <el-empty description="Open or create a workspace to begin." :image-size="96" />
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
