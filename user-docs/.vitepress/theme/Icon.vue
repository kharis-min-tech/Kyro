<script setup lang="ts">
/**
 * Line icons in the same style as the Kyro app (Lucide). Used instead of
 * emoji, e.g. <Icon name="bell" /> or a colour swatch <Icon name="dot" color="#ef4444" />.
 */
import { computed } from "vue";

const props = defineProps<{ name: string; color?: string; label?: string }>();

const PATHS: Record<string, string[]> = {
  sound: ["M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z", "M16 9a5 5 0 0 1 0 6", "M19.364 18.364a9 9 0 0 0 0-12.728"],
  check: ["M20 6 9 17l-5-5"],
  "check-circle": ["M21.801 10A10 10 0 1 1 17 3.335", "m9 11 3 3L22 4"],
  clock: ["M12 6v6l4 2", "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z"],
  bell: ["M10.268 21a2 2 0 0 0 3.464 0", "M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"],
  lock: ["M7 11V7a5 5 0 0 1 10 0v4", "M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z"],
  clipboard: ["M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z", "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"],
  warning: ["m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3", "M12 9v4", "M12 17h.01"],
  alert: ["M2.586 16.726A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2h6.624a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586z", "M12 8v4", "M12 16h.01"],
  seat: ["M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3", "M3 16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0z", "M5 18v2", "M19 18v2"],
  question: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3", "M12 17h.01"],
  close: ["M18 6 6 18", "m6 6 12 12"],
  pencil: ["M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"],
  menu: ["M4 12h16", "M4 6h16", "M4 18h16"],
  more: ["M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z", "M12 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2z", "M12 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"],
  cross: ["M12 2v20", "M7 7h10"],
};

const paths = computed(() => PATHS[props.name] ?? []);
</script>

<template>
  <span v-if="name === 'dot'" class="kyro-dot" :style="{ background: color }" :aria-label="label" :aria-hidden="label ? undefined : 'true'" />
  <svg v-else class="kyro-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
       stroke-linecap="round" stroke-linejoin="round" :style="color ? { color } : undefined"
       :role="label ? 'img' : undefined" :aria-label="label" :aria-hidden="label ? undefined : 'true'">
    <path v-for="d in paths" :key="d" :d="d" />
  </svg>
</template>

<style scoped>
.kyro-icon { width: 1.05em; height: 1.05em; display: inline-block; vertical-align: -0.16em; flex-shrink: 0; }
.kyro-dot { width: 0.8em; height: 0.8em; border-radius: 50%; display: inline-block; vertical-align: -0.05em; border: 1px solid var(--vp-c-divider); }
</style>
