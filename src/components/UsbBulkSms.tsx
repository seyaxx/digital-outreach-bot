"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import AdbWebCredentialStore from "@yume-chan/adb-credential-web";
import { Adb, AdbDaemonTransport } from "@yume-chan/adb";
import {
  AdbDaemonWebUsbDevice,
  AdbDaemonWebUsbDeviceManager,
} from "@yume-chan/adb-daemon-webusb";

type StringMap = Record<string, string>;

// mici utilitare
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const concatBytes = (chunks: Uint8Array[]) => {
  const size = chunks.reduce((a, c) => a + c.byteLength, 0);
  const out = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
};
const escapeForDoubleQuotes = (v: string) => v.replace(/[\\\"$`]/g, (m) => `\\${m}`);

// Normalizare număr (România) în E.164
function normalizeNumberRO(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  // păstrăm doar cifre și plus
  let d = s.replace(/[^\d+]/g, "");
  if (d.startsWith("00")) d = "+" + d.slice(2);
  if (!d.startsWith("+")) d = "+" + d;

  // cazuri comune: 07XXXXXXXX -> +407XXXXXXXX
  const justDigits = d.replace(/\D/g, "");
  // +407XXXXXXXX
  if (/^\+407\d{8}$/.test(d)) return d;
  // +40 7XXXXXXXX
  if (/^\+40\d{9}$/.test(d) && d.startsWith("+407")) return "+40" + d.slice(4);
  // 07XXXXXXXX
  if (/^\+0?7\d{8}$/.test(d)) return "+40" + justDigits.slice(-9);
  // 7XXXXXXXX
  if (/^\+?7\d{8}$/.test(s) || /^7\d{8}$/.test(s)) return "+40" + justDigits.slice(-9);

  // fallback: dacă are minim 9-15 cifre, îl returnăm cum e
  if (justDigits.length >= 9 && justDigits.length <= 15) return d;
  return null;
}

export default function UsbBulkSms() {
  const [manager] = useState(() => AdbDaemonWebUsbDeviceManager.BROWSER);
  const [device, setDevice] = useState<AdbDaemonWebUsbDevice | null>(null);
  const [adb, setAdb] = useState<Adb | null>(null);
  const [status, setStatus] = useState("Idle");
  const [log, setLog] = useState<string[]>([]);
  const [numbers, setNumbers] = useState("");
  const [message, setMessage] = useState("");
  const [busyError, setBusyError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [dryRun, setDryRun] = useState(false);

  const credStore = useMemo(
    () => new AdbWebCredentialStore("Luvo Studio — ADB Key"),
    []
  );

  function addLog(line: string) {
    setLog((p) => [`${new Date().toLocaleTimeString()} — ${line}`, ...p].slice(0, 500));
  }

  // rulează o comandă shell și returnează stdout ca string
  async function runShell(currentAdb: Adb, cmd: string): Promise<string> {
    if (!currentAdb.subprocess.shellProtocol) {
      const proc = await currentAdb.subprocess.noneProtocol.spawn(cmd);
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

    const proc = await currentAdb.subprocess.shellProtocol.spawn(cmd);
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
    await proc.exited;
    return new TextDecoder().decode(concatBytes(chunks));
  }

  // tap relativ la ecran; dacă nu putem citi dimensiunea, folosim 720x1600
  async function tapPercent(currentAdb: Adb, px: number, py: number) {
    let w = 720, h = 1600;
    try {
      const out = (await runShell(currentAdb, "wm size")).trim();
      const m = out.match(/Physical size:\s*(\d+)x(\d+)/i) || out.match(/(\d+)x(\d+)/);
      if (m) {
        w = parseInt(m[1], 10);
        h = parseInt(m[2], 10);
      }
    } catch {}
    const x = Math.max(0, Math.min(w - 1, Math.round(w * px)));
    const y = Math.max(0, Math.min(h - 1, Math.round(h * py)));
    await runShell(currentAdb, `input tap ${x} ${y}`);
  }

  async function connect() {
    setBusyError(null);
    try {
      setStatus("Searching devices…");
      // încearcă întâi device-urile deja autorizate
      let picked = (await manager.getDevices())[0];
      if (!picked) {
        setStatus("Requesting USB access…");
        picked = await manager.requestDevice();
      }
      if (!picked) {
        setStatus("No device selected");
        return;
      }
      setDevice(picked);

      setStatus("Opening USB interface…");
      const connection = await picked.connect();

      setStatus("ADB auth (check phone) …");
      const transport = await AdbDaemonTransport.authenticate({
        serial: picked.serial ?? "webusb",
        connection,
        credentialStore: credStore,
      });

      const _adb = new Adb(transport);
      setAdb(_adb);

      // info rapid
      let model = "Unknown";
      try { model = (await runShell(_adb, "getprop ro.product.model")).trim(); } catch {}
      setStatus(`Connected: ${model}`);
      addLog(`Device connected: ${model}`);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      setStatus("Connection error");
      addLog(`ERROR: ${msg}`);

      // dacă interfața e „claimed” de alt proces sau alt tab, afișăm ghidul
      if (
        /already.*in use|busy|open/i.test(msg) ||
        /Access denied|failed to open/i.test(msg)
      ) {
        setBusyError(
          "Interfața ADB este folosită de alt program sau alt tab. Închide procesele ADB, emulatoare/WSA/scrcpy, închide alte tab-uri și reconectează."
        );
      }
    }
  }

  async function disconnect() {
    try { await adb?.close?.(); } catch {}
    setAdb(null);
    setDevice(null);
    setStatus("Disconnected");
  }

  async function sendOne(currentAdb: Adb, rawNumber: string, body: string) {
    const num = normalizeNumberRO(rawNumber);
    if (!num) return { ok: false, err: "Număr invalid" };

    const safeBody = escapeForDoubleQuotes(body);

    addLog(`Compose → ${num}`);
    await runShell(
      currentAdb,
      `am start -a android.intent.action.SENDTO -d smsto:${num} --es sms_body "${safeBody}" --ez exit_on_sent true`
    );
    await sleep(650);

    if (dryRun) {
      addLog(`[DRY RUN] Ar fi apăsat Send`);
      return { ok: true };
    }

    // buton Send (Google Messages) — jos/dreapta
    await tapPercent(currentAdb, 0.93, 0.93);
    await sleep(450);
    return { ok: true };
  }

  async function handleSend() {
    if (!adb) {
      addLog("Nu ești conectat la telefon.");
      return;
    }
    const list = numbers
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (!list.length) { addLog("Nu ai introdus numere."); return; }
    if (!message.trim()) { addLog("Mesajul este gol."); return; }

    setStatus(`Sending to ${list.length} contacts…`);
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      try {
        const r = await sendOne(adb, n, message);
        if (r.ok) addLog(`✔ Sent to ${n}`);
        else addLog(`✖ ${n}: ${r.err}`);
      } catch (e: any) {
        addLog(`✖ ${n}: ${String(e?.message ?? e)}`);
      }
      await sleep(500);
    }
    setStatus("Done");
  }

  return (
    <div className="min-h-screen w-full bg-neutral-50 text-neutral-900">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">WebUSB ADB — Bulk SMS</h1>
          <div className="text-sm text-neutral-500">{status}</div>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <div className="md:col-span-2 bg-white rounded-2xl shadow p-4 space-y-4">
            <div className="flex items-center gap-2">
              {!adb ? (
                <button
                  className="px-4 py-2 rounded-2xl shadow bg-black text-white"
                  onClick={connect}
                >
                  Conectează telefon (USB)
                </button>
              ) : (
                <button
                  className="px-4 py-2 rounded-2xl shadow bg-neutral-200"
                  onClick={disconnect}
                >
                  Deconectează
                </button>
              )}
              <label className="flex items-center gap-2 text-sm ml-2">
                <input
                  type="checkbox"
                  checked={dryRun}
                  onChange={(e) => setDryRun(e.target.checked)}
                />
                Dry run (nu apasă Send)
              </label>
            </div>

            {busyError && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-6">
                <div className="font-semibold mb-1">Dispozitiv ocupat (ADB „in use”)</div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Închide programe care folosesc ADB: Android Studio, scrcpy/qtscrcpy, Vysor, BlueStacks/LDPlayer, WSA, Motorola/Lenovo LMSA, MyPhoneExplorer etc.</li>
                  <li>Închide alte tab-uri ale acestei aplicații.</li>
                  <li>Deconectează/reconectează cablul. Pe telefon: <b>USB debugging ON</b>, bifează <b>Always allow</b>.</li>
                  <li>Mod USB pe telefon: <b>File transfer (MTP)</b>. Oprește <b>USB tethering</b>.</li>
                  <li>Windows: driver pe interfața ADB trebuie să fie <b>WinUSB/Android ADB Interface</b> (nu „Motorola ADB Interface”).</li>
                </ul>
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Numere de telefon (unul pe linie)</label>
                <textarea
                  className="mt-2 w-full h-48 border rounded-xl p-3 font-mono text-sm"
                  placeholder="+40774951935\n0720057056\n7XXXXXXXX"
                  value={numbers}
                  onChange={(e) => setNumbers(e.target.value)}
                />
                <p className="text-xs text-neutral-500 mt-2">
                  Acceptă formatele 07XXXXXXXX, 7XXXXXXXX sau +407XXXXXXXX. Le normalizează automat la E.164 (+40…).
                </p>
              </div>
              <div>
                <label className="text-sm font-medium">Mesaj</label>
                <textarea
                  className="mt-2 w-full h-48 border rounded-xl p-3 text-sm"
                  placeholder="Scrie mesajul SMS…"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
                <button
                  className="mt-4 px-4 py-2 rounded-2xl shadow bg-indigo-600 text-white disabled:opacity-50"
                  onClick={handleSend}
                  disabled={!adb || isSending}
                >
                  {isSending ? "Sending…" : "Trimite"}
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow p-4">
            <div className="text-sm font-medium mb-2">Logs</div>
            <div className="h-80 overflow-auto font-mono text-xs whitespace-pre-wrap">
              {log.map((l, i) => (
                <div key={i} className="py-0.5 border-b border-neutral-100">
                  {l}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow p-4">
          <div className="text-sm font-semibold mb-2">USB checklist</div>
          <ul className="list-disc pl-5 text-sm space-y-1">
            <li>Servește aplicația pe <b>HTTPS</b> sau <b>localhost</b> (WebUSB cere context securizat).</li>
            <li>Telefon: <b>Developer options → USB debugging ON</b> și acceptă cheia RSA (bifează <b>Always allow</b>).</li>
            <li>Windows: driverul interfeței ADB = <b>WinUSB/Android ADB Interface</b>.</li>
            <li>Folosește un cablu de date și un port USB direct (fără hub).</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
