<template>
  <v-icon v-if="item.appId" size="small" :icon="mdiKeyChange" class="mr-1" />
  <v-icon v-else-if="item.subType === 'hd'" :icon="mdiSubdirectoryArrowRight" />
  <v-icon
    v-else-if="item.subType === 'rekey'"
    size="small"
    :icon="mdiKey"
    class="mr-1"
  />
  <v-icon v-else-if="item.isHot" :icon="mdiFire" />
  <v-icon
    v-else-if="item.seedId && item.slot != null"
    :icon="mdiWallet"
    size="small"
    class="mr-1"
  />
  <span v-else-if="item.vendor === 'trezor'" class="icon-wrapper pr-1">
    <v-icon>
      <trezor-icon :width="18" color="currentColor" />
    </v-icon>
    <span v-if="item.falcon" class="pq-badge">PQ</span>
  </span>
  <v-icon v-else-if="item.slot != null" class="pr-1">
    <ledger-icon :width="18" color="currentColor" />
  </v-icon>
  <v-icon v-else-if="item.falcon" :icon="mdiAtom" class="mr-1" />
  <v-icon v-else :icon="mdiEye" size="small" class="mr-1" />
</template>

<script setup lang="ts">
import type { AccountInfo } from "@/types";
import {
  mdiAtom,
  mdiEye,
  mdiFire,
  mdiKey,
  mdiKeyChange,
  mdiSubdirectoryArrowRight,
  mdiWallet,
} from "@mdi/js";

defineProps<{ item: AccountInfo }>();
</script>

<style scoped>
.icon-wrapper {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.pq-badge {
  position: absolute;
  top: -4px;
  right: -2px;
  background-color: #9c27b0;
  color: #fff;
  font-size: 8px;
  font-weight: 700;
  line-height: 1;
  padding: 1px 3px;
  border-radius: 6px;
  pointer-events: none;
}
</style>
