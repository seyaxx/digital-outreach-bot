// WebUSB ADB implementation using yume-chan library
import AdbWebCredentialStore from "@yume-chan/adb-credential-web";
import { Adb, AdbDaemonTransport } from "@yume-chan/adb";
import {
  AdbDaemonWebUsbDevice,
  AdbDaemonWebUsbDeviceManager,
} from "@yume-chan/adb-daemon-webusb";

export type WebAdbState = {
  adb: Adb | null;
  device: AdbDaemonWebUsbDevice | null;
  serial?: string;
  model?: string;
  manufacturer?: string;
  androidVersion?: string;
  sdk?: string;
  deviceName?: string;
  screenSize?: string;
  authorized: boolean;
  connected: boolean;
};

// Utility functions
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function escapeForDoubleQuotes(value: string) {
  return value.replace(/[\\"$`]/g, (m) => `\\${m}`);
}

// Concatenate Uint8Array chunks (browser-safe, no Buffer)
function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((a, c) => a + c.byteLength, 0);
  const out = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

// Run a shell command and return combined stdout
async function runShell(adb: Adb, cmd: string): Promise<string> {
  // Prefer shell protocol; Android 11+ supports it
  if (!adb.subprocess.shellProtocol) {
    // Fallback to none protocol
    const proc = await adb.subprocess.noneProtocol.spawn(cmd);
    const chunks: Uint8Array[] = [];
    const reader = proc.output.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    return new TextDecoder().decode(concatBytes(chunks));
  }

  const proc = await adb.subprocess.shellProtocol.spawn(cmd);
  const chunks: Uint8Array[] = [];
  const reader = proc.stdout.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  await proc.exited; // ensure finished
  return new TextDecoder().decode(concatBytes(chunks));
}

async function tapPercent(adb: Adb, px: number, py: number) {
  const size = (await runShell(adb, "wm size | sed 's/^[^:]*: *//' ")).trim();
  const [w, h] = size.split("x").map((n) => parseInt(n, 10));
  const x = Math.max(0, Math.min(w - 1, Math.round(w * px)));
  const y = Math.max(0, Math.min(h - 1, Math.round(h * py)));
  await runShell(adb, `input tap ${x} ${y}`);
}

export const WebAdb = {
  credentialStore: new AdbWebCredentialStore("Luvo Studio — ADB Key"),
  manager: AdbDaemonWebUsbDeviceManager.BROWSER,

  async requestConnect(): Promise<WebAdbState> {
    if (!this.manager) {
      throw new Error("WebUSB nu este suportat în acest browser");
    }

    const device = await this.manager.requestDevice();
    if (!device) {
      throw new Error("Niciun dispozitiv selectat");
    }

    const connection = await device.connect();
    
    const transport = await AdbDaemonTransport.authenticate({
      serial: device.serial ?? `${device.vendorId}:${device.productId}`,
      connection,
      credentialStore: this.credentialStore,
    });

    const adb = new Adb(transport);

    // Get device info
    const model = (await runShell(adb, "getprop ro.product.model")).trim();
    const serial = (await runShell(adb, "getprop ro.serialno")).trim();
    const manufacturer = (await runShell(adb, "getprop ro.product.manufacturer")).trim();
    const androidVersion = (await runShell(adb, "getprop ro.build.version.release")).trim();
    const sdk = (await runShell(adb, "getprop ro.build.version.sdk")).trim();
    const deviceName = (await runShell(adb, "getprop ro.product.device")).trim();
    const screenSize = (await runShell(adb, "wm size | sed 's/^[^:]*: *//' ")).trim();

    return { 
      adb, 
      device,
      model, 
      serial, 
      manufacturer,
      androidVersion,
      sdk,
      deviceName,
      screenSize,
      authorized: true,
      connected: true 
    };
  },

  async isPackageInstalled(adb: Adb, pkg: string): Promise<boolean> {
    const out = await runShell(adb, `pm list packages ${pkg}`);
    return out.split("\n").some((l) => l.includes(pkg));
  },

  async grantPermission(adb: Adb, pkg: string, perm: string): Promise<void> {
    await runShell(adb, `pm grant ${pkg} ${perm}`);
  },

  async installApkFromBlob(adb: Adb, file: File | Blob): Promise<void> {
    const tmpPath = "/data/local/tmp/_bulk_sms_helper.apk";
    const sync = await adb.sync();
    
    try {
      // Some builds expect { filename, file }, others expect direct file
      await sync.write({
        filename: tmpPath,
        file: file
      } as any);
    } catch (error) {
      console.error("Error writing APK:", error);
      throw error;
    }
    
    await sync.dispose?.();
    await runShell(adb, `pm install -r ${tmpPath}`);
  },

  async installApkFromUrl(adb: Adb, url: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Nu pot descărca APK-ul");
    const blob = await res.blob();
    await this.installApkFromBlob(adb, blob);
  },

  async sendSms(adb: Adb, number: string, message: string, dryRun = false): Promise<{ ok: boolean; error?: string }> {
    const cleanNumber = number.replace(/[^+\d]/g, "");
    if (!cleanNumber) return { ok: false, error: "Număr invalid" };

    // Use intent to prefill recipient + body; then tap Send
    const safeBody = escapeForDoubleQuotes(message);
    const cmd = `am start -a android.intent.action.SENDTO -d smsto:${cleanNumber} --es sms_body "${safeBody}" --ez exit_on_sent true`;

    await runShell(adb, cmd);
    await delay(650);

    if (dryRun) {
      return { ok: true };
    }

    // Send button ~ bottom-right (works well on 720x1600 and similar screens)
    await tapPercent(adb, 0.93, 0.93);
    await delay(400);

    return { ok: true };
  },

  shell: runShell,
};
