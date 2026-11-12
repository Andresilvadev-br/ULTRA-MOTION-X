<template>
  <button @click="open = !open">Toggle</button>
  <Transition name="fade"><div v-if="open" class="dropdown">Menu</div></Transition>
</template>
<script setup lang="ts">
import { ref } from "vue";

const _open = ref(false);
</script>
