import { useCallback, useMemo, useRef, useState } from "react";
import { WebAdb, type WebAdbState } from "@/lib/adb/webadb";
import { useToast } from "@/hooks/use-toast";

export interface UseWebAdbState extends WebAdbState {
  isBusy: boolean;
  lastError?: string;
  deviceInfo: string;
}

export function useWebAdb() {
  const { toast } = useToast();
  const [state, setState] = useState<UseWebAdbState>({
    adb: null,
    device: null,
    serial: undefined,
    model: undefined,
    manufacturer: undefined,
    androidVersion: undefined,
    sdk: undefined,
    deviceName: undefined,
    screenSize: undefined,
    authorized: false,
    connected: false,
    isBusy: false,
    deviceInfo: "Neconectat"
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
      const deviceInfo = `${res.model} (${res.manufacturer}) • Android ${res.androidVersion} • ${res.screenSize}`;
      
      setState(prev => ({
        ...prev,
        ...res,
        deviceInfo,
        isBusy: false
      }));
      
      toast({ title: "Telefon conectat cu succes!", description: deviceInfo });
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setState((s) => ({ ...s, lastError: msg, isBusy: false, connected: false, deviceInfo: "Eroare la conectare" }));
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

  const sendSms = useCallback(async (number: string, message: string, dryRun = false): Promise<{ ok: boolean; error?: string }> => {
    if (!state.adb) return { ok: false, error: "ADB nu este conectat" };
    
    try {
      return await WebAdb.sendSms(state.adb, number, message, dryRun);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Eroare necunoscută";
      return { ok: false, error: errorMsg };
    }
  }, [state.adb]);

  const shell = useCallback(
    async (cmd: string) => {
      if (!state.adb) throw new Error("Nu există conexiune ADB");
      return WebAdb.shell(state.adb, cmd);
    },
    [state.adb]
  );

  const disconnect = useCallback(async () => {
    if (state.adb) {
      try {
        await state.adb.close?.();
      } catch (error) {
        console.error("Error disconnecting:", error);
      }
    }
    
    setState({
      adb: null,
      device: null,
      serial: undefined,
      model: undefined,
      manufacturer: undefined,
      androidVersion: undefined,
      sdk: undefined,
      deviceName: undefined,
      screenSize: undefined,
      authorized: false,
      connected: false,
      isBusy: false,
      lastError: undefined,
      deviceInfo: "Deconectat"
    });
    
    toast({ title: "Telefon deconectat" });
  }, [state.adb, toast]);

  return useMemo(
    () => ({
      ...state,
      connect,
      disconnect,
      installFromUrl,
      installFromFile,
      isPackageInstalled,
      grantPermission,
      checkSmsPermission,
      sendSms,
      shell,
    }),
    [state, connect, disconnect, installFromUrl, installFromFile, isPackageInstalled, grantPermission, checkSmsPermission, sendSms, shell]
  );
}
