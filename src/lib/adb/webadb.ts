// Lightweight WebADB wrapper with relaxed types for browser usage
// Note: Using yume-chan WebUSB backend. Types are relaxed to ensure compatibility.
// Runtime errors will be surfaced via the caller and toasts.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let DeviceManager: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let AdbLib: any;

try {
  // Dynamically import to avoid type mismatches across versions
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  AdbLib = await import("@yume-chan/adb");
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const webusb = await import("@yume-chan/adb-daemon-webusb");
  DeviceManager = webusb.AdbDaemonWebUsbDeviceManager;
} catch (e) {
  // Fallback: leave undefined; callers should handle
}

export type WebAdbState = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adb: any | null;
  serial?: string;
  model?: string;
  authorized: boolean;
};

const manager = DeviceManager ? new DeviceManager() : null;

async function shell(adb: any, cmd: string): Promise<string> {
  if (!adb) throw new Error("ADB indisponibil");
  // Some versions expose `subprocess.shell(command)` returning a Readable
  const proc = await adb.subprocess.shell(cmd);
  const reader = proc.stdout?.getReader?.() ?? proc.readable?.getReader?.();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let out = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) out += decoder.decode(value);
    }
  } finally {
    try { reader.releaseLock?.(); } catch {}
  }
  try { await proc.kill?.(); } catch {}
  return out.trim();
}

export const WebAdb = {
  async requestConnect(): Promise<WebAdbState> {
    if (!manager || !AdbLib) throw new Error("WebUSB nu este suportat în acest browser");
    const device = await manager.requestDevice();
    const transport = await device.connect();
    // Newer versions expose `AdbLib.Adb.authenticate`, others `AdbLib.Adb.authenticate`
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const adb = (AdbLib.Adb?.authenticate
      ? await AdbLib.Adb.authenticate(transport)
      : await (AdbLib.authenticate ? AdbLib.authenticate(transport) : AdbLib.Adb.open(transport)));

    const model = (await shell(adb, "getprop ro.product.model")).trim();
    const serial = (await shell(adb, "getprop ro.serialno")).trim();

    return { adb, model, serial, authorized: true };
  },

  async isPackageInstalled(adb: any, pkg: string): Promise<boolean> {
    const out = await shell(adb, `pm list packages ${pkg}`);
    return out.split("\n").some((l) => l.includes(pkg));
  },

  async grantPermission(adb: any, pkg: string, perm: string): Promise<void> {
    await shell(adb, `pm grant ${pkg} ${perm}`);
  },

  async installApkFromBlob(adb: any, file: File | Blob): Promise<void> {
    // Try sync.write to /data/local/tmp then pm install -r
    const tmpPath = "/data/local/tmp/_bulk_sms_helper.apk";
    const sync = await adb.sync();
    // Some builds expect { filename, file }, others expect (path, file)
    try {
      await sync.write({ filename: tmpPath, file } as any);
    } catch {
      await sync.write(tmpPath, file as any);
    }
    await sync.dispose?.();
    await shell(adb, `pm install -r ${tmpPath}`);
  },

  async installApkFromUrl(adb: any, url: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Nu pot descărca APK-ul");
    const blob = await res.blob();
    await this.installApkFromBlob(adb, blob);
  },

  shell,
};
