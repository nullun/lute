<template>
  <account-table
    :accounts="accounts"
    :loading="loading"
    @get-addrs="getTrezorAddresses"
    @add-accounts="addAccounts"
  />
</template>

<script lang="ts" setup>
import { set } from "@/dbLute";
import Algo, { getAuthAccts } from "@/services/Algo";
import type { AccountSubs } from "@/types";
import { deepClone } from "@/utils";
import { mapTrezorError } from "@/utils/hwSigners";
import {
  TrezorAlgorandClient,
  WebUsbTransport,
  defaultAlgorandPath,
} from "trezor-algorand-js";

const store = useAppStore();
const loading = ref(false);
const accounts = ref<AccountSubs[]>([]);
const deviceModel = ref<string | undefined>();

const emit = defineEmits(["close"]);

onMounted(() => getTrezorAddresses(0));

async function getTrezorAddresses(startIndex: number) {
  let client: TrezorAlgorandClient | undefined;
  try {
    loading.value = true;
    if (!navigator.usb) {
      store.setSnackbar("This browser does not support WebUSB", "error");
      emit("close");
      return;
    }
    const existing = await WebUsbTransport.getFirst();
    const transport = existing ?? (await WebUsbTransport.request());
    client = await TrezorAlgorandClient.connect(transport);
    deviceModel.value = client.cachedFeatures()?.model;
    const accts: AccountSubs[] = [];
    const indexer = Algo.indexer;
    for (let i = startIndex; i < 4 + startIndex; i++) {
      const addr = await client.getAddress({ path: defaultAlgorandPath(i) });
      const ai: AccountSubs = await Algo.algod.accountInformation(addr).do();
      ai.subs = await getAuthAccts(addr, indexer);
      accts.push(ai);
    }
    accounts.value = accounts.value.concat(accts);
  } catch (err: any) {
    const mapped = mapTrezorError(err);
    console.error(mapped);
    store.setSnackbar(mapped.message, "error");
    emit("close");
  } finally {
    try {
      await client?.close();
    } catch {
      // ignore
    }
    loading.value = false;
  }
}

async function addAccounts(selected: AccountSubs[]) {
  const add = selected
    .filter((a) => !store.accounts.some((acct) => acct.addr === a.address))
    .map((a) => ({
      addr: a.address,
      slot: accounts.value.findIndex((acct) => acct.address === a.address),
      vendor: "trezor" as const,
      deviceModel: deviceModel.value,
    }));
  const newVal = deepClone(store.accounts.concat(add));
  await set("app", "accounts", newVal);
  await store.getCache();
  store.refresh++;
  emit("close");
}
</script>
