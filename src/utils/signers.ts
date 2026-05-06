import LuteTxns from "@/classes/LuteTxns";
import { get } from "@/dbLute";
import Algo from "@/services/Algo";
import Falcon from "@/services/Falcon";
import HdWallet from "@/services/HdWallet";
import Seed from "@/services/Seed";
import type { HardwareVendor, LuteMsig, WalletTransaction } from "@/types";
import {
  createHardwareSigner,
  type AlgorandHardwareSigner,
} from "@/utils/hwSigners";
import algosdk from "algosdk";
import { signCompressed } from "falcon-1024";
import { SignatureType, compileFalconLogicSig } from "trezor-algorand-js";

class SignTxnsError extends Error {
  code: number;
  data?: any;

  constructor(message: string, code: number, data?: any) {
    super(message);
    this.name = "SignTxnsError";
    this.code = code;
    this.data = data;
  }
}

export async function signer(
  txnGroup: algosdk.Transaction[],
  indexesToSign?: number[],
  authAddrs?: (string | undefined)[],
  password?: string,
  msig?: LuteMsig
) {
  const hwSigners = new Map<HardwareVendor, AlgorandHardwareSigner>();
  async function getHwSigner(vendor: HardwareVendor) {
    let s = hwSigners.get(vendor);
    if (!s) {
      s = await createHardwareSigner(vendor);
      hwSigners.set(vendor, s);
    }
    return s;
  }
  try {
    const store = useAppStore();
    const signedTxns: Uint8Array[] = [];
    const seeds: Uint8Array[] = [];

    type HwGroupItem = {
      idx: number;
      txn: algosdk.Transaction;
      addr: string;
    };
    const trezorGroups = new Map<string, HwGroupItem[]>();

    for (const [idx, txn] of txnGroup.entries()) {
      if (!indexesToSign || indexesToSign.includes(idx)) {
        const sender = txn.sender.toString();
        const info = store.info.find((i) => i.address === sender);
        const authAddr =
          msig?.signerAddr ||
          authAddrs?.[idx] ||
          info?.authAddr?.toString() ||
          sender;
        const acct = store.acctInfo.find((a) => a.addr === authAddr);
        if (!acct) throw Error("Account Not Found");
        let sig: Uint8Array;
        if (acct.seedId) {
          if (!seeds[acct.seedId]) {
            const seedData = store.seeds.find((s) => s.id === acct.seedId);
            if (!seedData) throw Error("Invalid Seed");
            if (seedData.credentialId) {
              seeds[acct.seedId] = (
                await Seed.getPasskeySeed(seedData.credentialId)
              ).seed;
            } else {
              if (!password) throw Error("Password Required");
              seeds[acct.seedId] = await Seed.decryptSeed(password, seedData);
            }
          }
          sig = new Uint8Array();
          if (acct.slot != null) {
            const prefixedTx = new Uint8Array([
              ...new TextEncoder().encode("TX"),
              ...txn.toByte(),
            ]);
            sig = await HdWallet.sign(
              Buffer.from(seeds[acct.seedId]!),
              acct.slot,
              prefixedTx,
              acct.info?.addrIdx
            );
          } else if (acct.falcon) {
            const lsigTeal = Falcon.getLsigTeal(
              acct.falcon.counter,
              Buffer.from(acct.falcon.publicKey, "base64")
            );
            const lsigCompiled = await Algo.algod.compile(lsigTeal).do();
            const lsigBytes = Buffer.from(lsigCompiled.result, "base64");
            const falconPair = Falcon.keyPair(seeds[acct.seedId]!);
            const arg = signCompressed(falconPair.privateKey, txn.rawTxID());
            const logicSig = new algosdk.LogicSigAccount(lsigBytes, [arg]);
            const slstxn = algosdk.signLogicSigTransactionObject(txn, logicSig);
            signedTxns[idx] = slstxn.blob;
            continue;
          }
        } else if (acct.slot != null && acct.vendor) {
          if (acct.vendor === "trezor") {
            // Firmware requires tx.sender == derived signer; reject rekey.
            if (sender !== acct.addr) {
              throw Error(
                "Trezor does not yet support signing rekeyed transactions",
                { cause: 4300 }
              );
            }
            const key = `${acct.addr}:${Buffer.from(txn.group ?? new Uint8Array()).toString("base64")}`;
            if (!trezorGroups.has(key)) trezorGroups.set(key, []);
            trezorGroups.get(key)!.push({ idx, txn, addr: authAddr });
            continue;
          }
          const hw = await getHwSigner(acct.vendor);
          sig = await hw.signTx(acct.slot, txn.toByte());
        } else if (acct.slot != null) {
          // Legacy hardware account with no vendor stamped; treat as Ledger.
          const hw = await getHwSigner("ledger");
          sig = await hw.signTx(acct.slot, txn.toByte());
        } else {
          sig = await hotSign(authAddr, txn.bytesToSign());
        }
        let signedTxn: Uint8Array;
        if (msig?.bypass) {
          signedTxn = attachMsigSig(msig, txn, sig);
        } else {
          signedTxn = txn.attachSignature(authAddr, sig);
        }
        signedTxns[idx] = signedTxn;
      }
    }

    // Flush pending Trezor groups.
    // The device validates the groupID by hashing all provided transactions,
    // so always send the full atomic group regardless of signature type.
    for (const items of trezorGroups.values()) {
      const first = items[0]!;
      const acct = store.acctInfo.find((a) => a.addr === first.addr)!;
      const hw = (await getHwSigner("trezor")) as AlgorandHardwareSigner;
      const isFalcon = !!acct.falcon;
      const sigType = isFalcon
        ? SignatureType.FALCON_DET1024
        : SignatureType.ED25519;

      if (txnGroup.length > 1) {
        // Send the entire atomic group so the device can validate the groupID.
        // It returns signatures only for transactions matching the signer;
        // empty signatures for the rest.
        const sigs = await hw.signTxGroup(
          acct.slot!,
          txnGroup.map((t) => t.toByte()),
          sigType
        );
        for (const { idx, addr } of items) {
          const sig = sigs[idx];
          if (!sig || sig.length === 0) continue;
          const txn = txnGroup[idx]!;
          if (isFalcon && acct.falcon) {
            const program = compileFalconLogicSig({
              publicKey: Buffer.from(acct.falcon.publicKey, "base64"),
              counter: acct.falcon.counter,
            });
            const logicSig = new algosdk.LogicSigAccount(program, [sig]);
            const slstxn = algosdk.signLogicSigTransactionObject(txn, logicSig);
            signedTxns[idx] = slstxn.blob;
          } else {
            const signedTxn = msig?.bypass
              ? attachMsigSig(msig, txn, sig)
              : txn.attachSignature(addr, sig);
            signedTxns[idx] = signedTxn;
          }
        }
      } else {
        // Single transaction (no group) — use signTx directly.
        const sig = await hw.signTx(acct.slot!, first.txn.toByte(), sigType);
        if (!sig || sig.length === 0) continue;
        const { idx, txn, addr } = first;
        if (isFalcon && acct.falcon) {
          const program = compileFalconLogicSig({
            publicKey: Buffer.from(acct.falcon.publicKey, "base64"),
            counter: acct.falcon.counter,
          });
          const logicSig = new algosdk.LogicSigAccount(program, [sig]);
          const slstxn = algosdk.signLogicSigTransactionObject(txn, logicSig);
          signedTxns[idx] = slstxn.blob;
        } else {
          const signedTxn = msig?.bypass
            ? attachMsigSig(msig, txn, sig)
            : txn.attachSignature(addr, sig);
          signedTxns[idx] = signedTxn;
        }
      }
    }

    seeds.forEach((s) => s.fill(0));
    for (const hw of hwSigners.values()) await hw.close();
    // Compact (drop undefined slots from unsigned indexes).
    return signedTxns.filter((t) => t != null) as Uint8Array[];
  } catch (err) {
    for (const hw of hwSigners.values()) await hw.close();
    throw err;
  }
}

function attachMsigSig(
  msig: LuteMsig,
  txn: algosdk.Transaction,
  sig: Uint8Array
) {
  const mparams = {
    version: 1,
    threshold: Number(msig.app.arc55_threshold),
    addrs: msig.app.addrs,
  };
  const msigTxn = algosdk.createMultisigTransaction(txn, mparams);
  return algosdk.appendSignRawMultisigSignature(
    msigTxn,
    mparams,
    msig.signerAddr,
    sig
  ).blob;
}

export async function hotSign(addr: string, bytes: Uint8Array) {
  const privateKey: CryptoKey | undefined = await get("keys", addr);
  if (!privateKey) throw Error("Account Not Found", { cause: 4300 });
  const sig = await crypto.subtle.sign(
    { name: "Ed25519" },
    privateKey,
    Buffer.from(bytes)
  );
  return new Uint8Array(sig);
}

export async function luteSigner(
  txnGroup: algosdk.Transaction[],
  indexesToSign?: number[]
) {
  const walletTxns: WalletTransaction[] = txnGroup.map((tx, idx) => {
    const txn = Buffer.from(tx.toByte()).toString("base64");
    if (!indexesToSign || indexesToSign.includes(idx)) return { txn };
    else return { txn, signers: [] };
  });
  return luteSignerWT(walletTxns);
}

export async function luteSignerWT(walletTxns: WalletTransaction[]) {
  const store = useAppStore();
  store.setSnackbar("Awaiting Signatures...", "info", -1);
  const signedTxns = await new Promise<Uint8Array[]>((resolve, reject) => {
    store.luteTxns = new LuteTxns(walletTxns);
    window.addEventListener("modal-signer", listener);
    function listener(message: any) {
      if (message.detail.debug) console.log("[Lute Debug]", message.detail);
      switch (message.detail.action) {
        case "signed": {
          window.removeEventListener("modal-signer", listener);
          resolve(
            message.detail.txns.map((txn: string) =>
              txn ? Buffer.from(txn, "base64") : null
            )
          );
          break;
        }
        case "error": {
          window.removeEventListener("modal-signer", listener);
          reject(
            new SignTxnsError(
              message.detail.message,
              message.detail.code || 4300
            )
          );
          break;
        }
        case "close":
          window.removeEventListener("modal-signer", listener);
          reject(new SignTxnsError("User Rejected Request", 4100));
          break;
      }
      return undefined;
    }
  });
  store.overlay = true;
  store.setSnackbar("Processing...", "info", -1);
  return signedTxns;
}
