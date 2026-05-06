<template>
  <div>
    <v-btn-toggle v-model="addressType" mandatory class="mb-2">
      <v-btn value="ed25519" size="small">ED25519</v-btn>
      <v-btn value="falcon" size="small">FALCON</v-btn>
    </v-btn-toggle>
    <account-table
      :accounts="accounts"
      :loading="loading"
      @get-addrs="getTrezorAddresses"
      @add-accounts="addAccounts"
    />
  </div>
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
import type { FalconAddressResult } from "trezor-algorand-js";

const store = useAppStore();
const loading = ref(false);
const accounts = ref<AccountSubs[]>([]);
const deviceModel = ref<string | undefined>();
const addressType = ref<"ed25519" | "falcon">("ed25519");
// Stash FALCON metadata keyed by address for use in addAccounts
const falconMeta = ref<Map<string, { counter: number; publicKey: string }>>(
  new Map()
);

// Keep the transport alive across address-type toggles so we don't need a
// fresh user gesture for each switch.
let persistentTransport: WebUsbTransport | undefined;

const emit = defineEmits(["close"]);

onMounted(() => getTrezorAddresses(0));

onBeforeUnmount(async () => {
  try {
    await persistentTransport?.close();
  } catch {
    // ignore
  }
});

watch(addressType, () => {
  accounts.value = [];
  falconMeta.value.clear();
  getTrezorAddresses(0);
});

async function getTrezorAddresses(startIndex: number) {
  let client: TrezorAlgorandClient | undefined;
  try {
    loading.value = true;
    if (!navigator.usb) {
      store.setSnackbar("This browser does not support WebUSB", "error");
      emit("close");
      return;
    }
    if (!persistentTransport) {
      const existing = await WebUsbTransport.getFirst();
      persistentTransport = existing ?? (await WebUsbTransport.request());
    }
    client = await TrezorAlgorandClient.connect(persistentTransport);
    deviceModel.value = client.cachedFeatures()?.model;
    const accts: AccountSubs[] = [];
    const indexer = Algo.indexer;
    for (let i = startIndex; i < 4 + startIndex; i++) {
      let addr: string;
      if (addressType.value === "falcon") {
        const result: FalconAddressResult = await client.getFalconAddress({
          path: defaultAlgorandPath(i),
        });
        addr = result.address;
        falconMeta.value.set(addr, {
          counter: result.counter ?? 0,
          publicKey: Buffer.from(result.publicKey).toString("base64"),
        });
      } else {
        addr = await client.getAddress({ path: defaultAlgorandPath(i) });
      }
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
    .map((a) => {
      const slot = accounts.value.findIndex(
        (acct) => acct.address === a.address
      );
      const base: any = {
        addr: a.address,
        slot,
        vendor: "trezor" as const,
        deviceModel: deviceModel.value,
      };
      if (addressType.value === "falcon") {
        const meta = falconMeta.value.get(a.address);
        if (meta) base.falcon = meta;
      }
      return base;
    });
  const newVal = deepClone(store.accounts.concat(add));
  await set("app", "accounts", newVal);
  await store.getCache();
  store.refresh++;
  emit("close");
}
</script>
