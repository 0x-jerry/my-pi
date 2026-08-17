<script setup lang="ts">
import NavRail from "./components/NavRail.vue"
import { useStore } from "./store"

const store = useStore()
</script>

<template>
  <div class="app">
    <el-alert
      v-if="store.state.error"
      type="error"
      :closable="false"
      class="banner err"
    >
      {{ store.state.error }}
    </el-alert>

    <NavRail />

    <router-view />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  height: 100vh;
  position: relative;
}
.banner.err {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
}
</style>
