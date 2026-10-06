<script setup lang="ts">
/**
 * <Shot name="ai-count" alt="…" /> — a screenshot in a browser-style frame.
 * Shows /screenshots/<name>.png in light mode and <name>-dark.png in dark
 * mode. `phone` frames a narrow phone screenshot instead; `size` keeps a
 * cropped card screenshot from stretching to the full page width.
 */
import { withBase } from "vitepress";
const props = defineProps<{ name: string; alt: string; caption?: string; phone?: boolean; size?: "card" | "wide-card" }>();
const light = withBase(`/screenshots/${props.name}.png`);
const dark = withBase(`/screenshots/${props.name}-dark.png`);
</script>

<template>
  <figure class="kyro-shot" :class="[{ phone }, size]">
    <div class="frame">
      <img class="only-light" :src="light" :alt="alt" loading="lazy" />
      <img class="only-dark" :src="dark" :alt="alt" loading="lazy" />
    </div>
    <figcaption v-if="caption">{{ caption }}</figcaption>
  </figure>
</template>
