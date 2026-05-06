<template>
  <svg
    :width="width"
    :height="height"
    :fill="color"
    :opacity="opacity"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    @click="$emit('click')">
    <path
      fill-rule="evenodd"
      clip-rule="evenodd"
      d="M12 0C8.68629 0 6 2.68629 6 6V9H4C3.44772 9 3 9.44772 3 10V19.2C3 19.6255 3.26852 20.0046 3.67058 20.1467L11.6706 22.9467C11.8826 23.0178 12.1174 23.0178 12.3294 22.9467L20.3294 20.1467C20.7315 20.0046 21 19.6255 21 19.2V10C21 9.44772 20.5523 9 20 9H18V6C18 2.68629 15.3137 0 12 0ZM16 9V6C16 3.79086 14.2091 2 12 2C9.79086 2 8 3.79086 8 6V9H16ZM5 11V18.4899L12 20.9399L19 18.4899V11H5Z"/>
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
