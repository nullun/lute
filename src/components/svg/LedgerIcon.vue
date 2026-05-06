<template>
  <svg
    :width="width"
    :height="height"
    :fill="color"
    :opacity="opacity"
    viewBox="-3 -3 775 676"
    xmlns="http://www.w3.org/2000/svg"
    @click="$emit('click')"
  >
    <path d="M0,0v190.06h55V55h234.22V0H0z M479.69,0v55h234.22v135.06h55V0H479.69z M289.64,190.06v289.22h190.05v-50H344.64V190.06H289.64z M0,479.29v190.06h289.22v-55H55V479.29H0z M713.91,479.29v135.06H479.69v55h289.22V479.29H713.91z" />
  </svg>
</template>

<script lang="ts">
export default {
  props: {
    width: { type: Number, default: 24 },
    height: { type: Number, default: null },
    color: { type: String, default: "currentColor" },
    opacity: { type: Number, default: 1 },
  },
  emits: ["click"],
};
</script>
