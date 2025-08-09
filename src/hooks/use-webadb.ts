import { useCallback, useMemo, useRef, useState } from "react";
import { WebAdb } from "@/lib/adb/webadb";
import { useToast } from "@/hooks/use-toast";

export type UseWebAdbState = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adb: any | null;
  model?: string;
  serial?: string;
  connected: boolean;
  authorized: boolean;
  isBusy: boolean;
  lastError?: string;
};

export function useWebAdb() {
  const { toast } = useToast();
  const [state, setState] = useState<UseWebAdbState>({
    adb: null,
    connected: false,
    authorized: false,
    isBusy: false,
  });

  const busyRef = useRef(false);

  const setBusy = (b: boolean) => {
    busyRef.current = b;
    setState((s) => ({ ...s, isBusy: b }));
  };

  const connect = useCallback(async () => {
    try {
      setBusy(true);
      const res = await WebAdb.requestConnect();
      setState({
        adb: res.adb,
        model: res.model,
        serial: res.serial,
        authorized: res.authorized ?? true,
        connected: !!res.adb,
        isBusy: false,
      });
      toast({ title: "Telefon conectat", description: `${res.model ?? "(necunoscut)"} • ${res.serial ?? ""}` });
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setState((s) => ({ ...s, lastError: msg }));
      toast({ title: "Eroare conectare", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }, [toast]);

  const installFromUrl = useCallback(
    async (url: string) => {
      if (!state.adb) throw new Error("Nu există conexiune ADB");
      try {
        setBusy(true);
        await WebAdb.installApkFromUrl(state.adb, url);
        toast({ title: "APK instalat", description: "Pachetul a fost instalat cu succes." });
      } catch (e: any) {
        toast({ title: "Eroare instalare", description: e?.message ?? String(e), variant: "destructive" });
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [state.adb, toast]
  );

  const installFromFile = useCallback(
    async (file: File) => {
      if (!state.adb) throw new Error("Nu există conexiune ADB");
      try {
        setBusy(true);
        await WebAdb.installApkFromBlob(state.adb, file);
        toast({ title: "APK instalat", description: file.name });
      } catch (e: any) {
        toast({ title: "Eroare instalare", description: e?.message ?? String(e), variant: "destructive" });
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [state.adb, toast]
  );

  const isPackageInstalled = useCallback(
    async (pkg: string) => {
      if (!state.adb) return false;
      try {
        return await WebAdb.isPackageInstalled(state.adb, pkg);
      } catch {
        return false;
      }
    },
    [state.adb]
  );

  const grantPermission = useCallback(
    async (pkg: string, perm: string) => {
      if (!state.adb) throw new Error("Nu există conexiune ADB");
      try {
        setBusy(true);
        await WebAdb.grantPermission(state.adb, pkg, perm);
        toast({ title: "Permisiune acordată", description: perm });
      } catch (e: any) {
        toast({ title: "Eroare permisiune", description: e?.message ?? String(e), variant: "destructive" });
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [state.adb, toast]
  );

  const checkSmsPermission = useCallback(
    async (pkg: string) => {
      if (!state.adb) return false;
      try {
        const dump = await WebAdb.shell(state.adb, `dumpsys package ${pkg}`);
        if (!dump) return false;
        // try to find in granted permissions section
        const lower = dump.toLowerCase();
        return lower.includes("grantedpermissions") && lower.includes("android.permission.send_sms");
      } catch {
        return false;
      }
    },
    [state.adb]
  );

  const shell = useCallback(
    async (cmd: string) => {
      if (!state.adb) throw new Error("Nu există conexiune ADB");
      return WebAdb.shell(state.adb, cmd);
    },
    [state.adb]
  );

  return useMemo(
    () => ({
      ...state,
      connect,
      installFromUrl,
      installFromFile,
      isPackageInstalled,
      grantPermission,
      checkSmsPermission,
      shell,
    }),
    [state, connect, installFromUrl, installFromFile, isPackageInstalled, grantPermission, checkSmsPermission, shell]
  );
}
