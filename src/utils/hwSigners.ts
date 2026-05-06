import type { HardwareVendor } from "@/types";
import { selectDevice } from "@/utils";
import TransportWebHID from "@ledgerhq/hw-transport-webhid";
import TransportWebUSB from "@ledgerhq/hw-transport-webusb";
import { AlgorandApp } from "ledger-algorand-js";
import {
  TrezorAlgorandClient,
  WebUsbTransport,
  defaultAlgorandPath,
  DeviceNotFoundError,
  UserRejectedError,
  UnsupportedFirmwareError,
  CapabilityMissingError,
  BootloaderModeError,
  TransportError,
  ProtocolError,
  InvalidGroupError,
  SignatureType,
} from "trezor-algorand-js";

export interface AlgorandHardwareSigner {
  vendor: HardwareVendor;
  deviceModel?: string;
  getAddress(slot: number): Promise<string>;
  signTx(
    slot: number,
    tx: Uint8Array,
    signatureType?: SignatureType
  ): Promise<Uint8Array>;
  signTxGroup(
    slot: number,
    txs: Uint8Array[],
    signatureType?: SignatureType
  ): Promise<Uint8Array[]>;
  close(): Promise<void>;
}

export async function createHardwareSigner(
  vendor: HardwareVendor
): Promise<AlgorandHardwareSigner> {
  if (vendor === "ledger") return LedgerSigner.open();
  if (vendor === "trezor") return TrezorSigner.open();
  throw Error(`Unknown hardware vendor: ${vendor}`);
}

class LedgerSigner implements AlgorandHardwareSigner {
  readonly vendor: HardwareVendor = "ledger";
  private readonly transport: any;
  private readonly app: AlgorandApp;

  private constructor(transport: any, app: AlgorandApp) {
    this.transport = transport;
    this.app = app;
  }

  static async open(): Promise<LedgerSigner> {
    const store = useAppStore();
    await store.getDevices();
    const t = store.device.transport;
    if (!t) throw Error("This browser does not support Ledger");
    const hidOrUsb = t === "hid" ? TransportWebHID : TransportWebUSB;
    const firstDevice = store.device.list[0] as HIDDevice & USBDevice;
    let transport;
    if (firstDevice && !store.ledgerSelect) {
      transport = await hidOrUsb.open(firstDevice);
    } else {
      store.device.showSelector = true;
      const device = await selectDevice();
      store.device.showSelector = false;
      transport = await hidOrUsb.open(device);
    }
    return new LedgerSigner(transport, new AlgorandApp(transport));
  }

  async getAddress(slot: number): Promise<string> {
    const resp = await this.app.getAddressAndPubKey(slot);
    return resp.address.toString();
  }

  async signTx(slot: number, tx: Uint8Array): Promise<Uint8Array> {
    const store = useAppStore();
    store.setSnackbar("Review on Ledger...", "info", -1);
    try {
      const { signature } = await this.app.sign(slot, Buffer.from(tx));
      return new Uint8Array(signature);
    } catch (err: any) {
      if (err.message?.includes("rejected")) {
        throw Error("User Rejected Request", { cause: 4001 });
      }
      throw err;
    }
  }

  async signTxGroup(slot: number, txs: Uint8Array[]): Promise<Uint8Array[]> {
    const sigs: Uint8Array[] = [];
    for (const tx of txs) sigs.push(await this.signTx(slot, tx));
    return sigs;
  }

  async close(): Promise<void> {
    await this.transport?.close();
  }
}

class TrezorSigner implements AlgorandHardwareSigner {
  readonly vendor: HardwareVendor = "trezor";
  readonly deviceModel?: string;
  private readonly transport: WebUsbTransport;
  private readonly client: TrezorAlgorandClient;

  private constructor(
    transport: WebUsbTransport,
    client: TrezorAlgorandClient
  ) {
    this.transport = transport;
    this.client = client;
    this.deviceModel = client.cachedFeatures()?.model;
  }

  static async open(): Promise<TrezorSigner> {
    try {
      const existing = await WebUsbTransport.getFirst();
      const transport = existing ?? (await WebUsbTransport.request());
      const client = await TrezorAlgorandClient.connect(transport);
      return new TrezorSigner(transport, client);
    } catch (err) {
      throw mapTrezorError(err);
    }
  }

  async getAddress(slot: number): Promise<string> {
    try {
      return await this.client.getAddress({ path: defaultAlgorandPath(slot) });
    } catch (err) {
      throw mapTrezorError(err);
    }
  }

  async signTx(slot: number, tx: Uint8Array, signatureType?: SignatureType): Promise<Uint8Array> {
    const store = useAppStore();
    store.setSnackbar("Review on Trezor...", "info", -1);
    try {
      return await this.client.signTx({
        path: defaultAlgorandPath(slot),
        tx,
        signatureType,
      });
    } catch (err) {
      throw mapTrezorError(err);
    }
  }

  async signTxGroup(slot: number, txs: Uint8Array[], signatureType?: SignatureType): Promise<Uint8Array[]> {
    if (txs.length === 1) return [await this.signTx(slot, txs[0]!, signatureType)];
    if (txs.length > 16) {
      throw Error(
        "Trezor supports signing at most 16 transactions per group",
        { cause: 4300 }
      );
    }
    const store = useAppStore();
    store.setSnackbar("Review on Trezor...", "info", -1);
    try {
      return await this.client.signTxGroup({
        path: defaultAlgorandPath(slot),
        txs,
        signatureType,
      });
    } catch (err) {
      throw mapTrezorError(err);
    }
  }

  async signData(
    slot: number,
    data: Uint8Array,
    domain: string,
    authData: Uint8Array,
    requestId?: string
  ): Promise<Uint8Array> {
    const store = useAppStore();
    store.setSnackbar("Review on Trezor...", "info", -1);
    try {
      return await this.client.signData({
        path: defaultAlgorandPath(slot),
        data,
        domain,
        authData,
        requestId,
      });
    } catch (err) {
      throw mapTrezorError(err);
    }
  }

  async close(): Promise<void> {
    try {
      await this.client.close();
    } catch {
      // ignore
    }
  }
}

export { TrezorSigner, LedgerSigner };

export function mapTrezorError(err: unknown): Error {
  if (err instanceof UserRejectedError) {
    return Object.assign(Error("User Rejected Request"), { cause: 4001 });
  }
  if (err instanceof DeviceNotFoundError) {
    return Error("No Trezor found — make sure it's plugged in");
  }
  if (err instanceof UnsupportedFirmwareError) {
    return Error("Update your Trezor firmware to use Algorand");
  }
  if (err instanceof CapabilityMissingError) {
    return Error("This Trezor firmware does not support Algorand");
  }
  if (err instanceof BootloaderModeError) {
    return Error("Exit bootloader mode and reconnect");
  }
  if (err instanceof TransportError) {
    return Error("Trezor connection lost — reconnect and try again");
  }
  if (err instanceof InvalidGroupError || err instanceof ProtocolError) {
    console.error(err);
    return Error("Trezor signing failed. Please try again.");
  }
  return err as Error;
}
