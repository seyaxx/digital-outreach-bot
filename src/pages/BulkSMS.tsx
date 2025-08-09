import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Phone,
  Upload,
  Play,
  Pause,
  StopCircle,
  CheckCircle2,
  AlertTriangle,
  FileText,
} from "lucide-react";

const API_BASE = "http://localhost:8765";

type PhoneStatus = {
  connected?: boolean;
  deviceModel?: string;
  apkInstalled?: boolean;
  permissions?: {
    sendSms?: boolean;
  };
};

function upsertMeta(name: string, content: string) {
  let tag = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute("name", name);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

function upsertCanonical(href: string) {
  let link = document.querySelector("link[rel=canonical]") as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.setAttribute("rel", "canonical");
    document.head.appendChild(link);
  }
  link.setAttribute("href", href);
}

const numberRegex = /^07\d{8}$/; // strict: 07xxxxxxxx

const BulkSMS: React.FC = () => {
  const { toast } = useToast();
  const qc = useQueryClient();

  useEffect(() => {
    document.title = "Bulk SMS Android USB | Fast & Reliable";
    upsertMeta(
      "description",
      "Bulk SMS via Android USB: upload .txt, validate 07 numbers, manage permissions, send reliably with logs."
    );
    upsertCanonical(window.location.href);
  }, []);

  const [numbers, setNumbers] = useState<string[]>([]);
  const [invalidNumbers, setInvalidNumbers] = useState<string[]>([]);
  const [message, setMessage] = useState<string>("");
  const [ratePerMinute, setRatePerMinute] = useState<number>(20);
  const [isSending, setIsSending] = useState<boolean>(false);
  const validCount = numbers.length;

  const {
    data: status,
    isLoading: statusLoading,
    refetch: refetchStatus,
  } = useQuery<PhoneStatus>({
    queryKey: ["phone-status"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/status`);
      if (!res.ok) throw new Error("Nu pot obține statusul");
      return res.json();
    },
    refetchInterval: 2000,
  });

  const { data: logs } = useQuery<{ lines: string[] }>({
    queryKey: ["sms-logs"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/logs`);
      if (!res.ok) return { lines: [] };
      return res.json();
    },
    enabled: true,
    refetchInterval: isSending ? 1500 : 4000,
  });

  const ensureAdb = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/adb/ensure`, { method: "POST" });
      if (!res.ok) throw new Error("ADB ensure a eșuat");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "ADB gata", description: "Conexiunea ADB a fost inițializată." });
      refetchStatus();
    },
    onError: (e: any) => toast({ title: "Eroare ADB", description: e?.message ?? "Unknown", variant: "destructive" }),
  });

  const installApk = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/apk/install`, { method: "POST" });
      if (!res.ok) throw new Error("Instalarea APK a eșuat");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "APK instalat", description: "Helper APK a fost instalat." });
      refetchStatus();
    },
    onError: (e: any) => toast({ title: "Eroare APK", description: e?.message ?? "Unknown", variant: "destructive" }),
  });

  const grantPerms = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/permissions/grant`, { method: "POST" });
      if (!res.ok) throw new Error("Acordarea permisiunilor a eșuat");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Permisiuni OK", description: "Permisiuni SMS acordate." });
      refetchStatus();
    },
    onError: (e: any) => toast({ title: "Eroare permisiuni", description: e?.message ?? "Unknown", variant: "destructive" }),
  });

  const testSend = useMutation({
    mutationFn: async (payload: { number: string; message: string }) => {
      const res = await fetch(`${API_BASE}/send/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Test SMS a eșuat");
      return res.json();
    },
    onSuccess: () => toast({ title: "Test trimis", description: "SMS de test trimis." }),
    onError: (e: any) => toast({ title: "Eroare test", description: e?.message ?? "Unknown", variant: "destructive" }),
  });

  const startBulk = useMutation({
    mutationFn: async (payload: { numbers: string[]; message: string; ratePerMinute: number }) => {
      const res = await fetch(`${API_BASE}/send/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Pornirea bulk a eșuat");
      return res.json();
    },
    onMutate: () => setIsSending(true),
    onSuccess: () => toast({ title: "Bulk pornit", description: "Procesul de trimitere a început." }),
    onError: (e: any) => {
      setIsSending(false);
      toast({ title: "Eroare bulk", description: e?.message ?? "Unknown", variant: "destructive" });
    },
  });

  const pauseBulk = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/send/pause`, { method: "POST" });
      if (!res.ok) throw new Error("Pauza a eșuat");
      return res.json();
    },
    onSuccess: () => toast({ title: "Pauză", description: "Procesul a fost pus pe pauză." }),
  });

  const stopBulk = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/send/stop`, { method: "POST" });
      if (!res.ok) throw new Error("Oprirea a eșuat");
      return res.json();
    },
    onSuccess: () => {
      setIsSending(false);
      toast({ title: "Oprit", description: "Procesul a fost oprit." });
    },
  });

  const handleFile = async (file?: File | null) => {
    if (!file) return;
    const text = await file.text();
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

    const set = new Set<string>();
    const invalid: string[] = [];

    for (const raw of lines) {
      const num = raw.replace(/\s+/g, "");
      if (numberRegex.test(num)) {
        set.add(num);
      } else {
        invalid.push(raw);
      }
    }

    setNumbers(Array.from(set));
    setInvalidNumbers(invalid);

    toast({ title: "Fișier încărcat", description: `${Array.from(set).length} valide, ${invalid.length} invalide` });
  };

  const canStart = useMemo(() => {
    return message.trim().length > 0 && numbers.length > 0 && ratePerMinute > 0;
  }, [message, numbers, ratePerMinute]);

  return (
    <div>
      <header className="border-b">
        <div className="container mx-auto max-w-6xl px-4 py-6">
          <nav className="mb-2 text-sm text-muted-foreground">
            <Link to="/" className="hover:underline">Acasă</Link>
            <span className="mx-2">/</span>
            <span>Bulk SMS</span>
          </nav>
          <h1 className="text-3xl font-semibold tracking-tight">Bulk SMS Android USB</h1>
          <p className="text-muted-foreground mt-1">Încarcă numere (07xxxxxxxx), scrie mesajul, gestionează permisiuni și trimite.</p>
        </div>
      </header>

      <main className="container mx-auto max-w-6xl px-4 py-6 grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>1) Numere de telefon</CardTitle>
              <CardDescription>Fișier .txt, câte un număr pe linie. Doar format 07xxxxxxxx (10 cifre)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Input type="file" accept=".txt" onChange={(e) => handleFile(e.target.files?.[0])} />
                <Button variant="outline" onClick={() => { setNumbers([]); setInvalidNumbers([]); }}>Reset</Button>
              </div>
              <div className="text-sm text-muted-foreground">
                <span className="mr-4">Valide: <strong className="text-foreground">{validCount}</strong></span>
                <span className="mr-4">Invalide: <strong className="text-foreground">{invalidNumbers.length}</strong></span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-2 text-sm"><CheckCircle2 className="h-4 w-4" /> Valide</div>
                  <div className="max-h-48 overflow-auto rounded-md border">
                    <ul className="text-sm p-3 space-y-1">
                      {numbers.slice(0, 200).map((n) => (
                        <li key={n} className="font-mono">{n}</li>
                      ))}
                      {numbers.length > 200 && (
                        <li className="text-muted-foreground">... și încă {numbers.length - 200} numere</li>
                      )}
                    </ul>
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-2 text-sm"><AlertTriangle className="h-4 w-4" /> Invalide</div>
                  <div className="max-h-48 overflow-auto rounded-md border">
                    <ul className="text-sm p-3 space-y-1">
                      {invalidNumbers.slice(0, 200).map((n, idx) => (
                        <li key={`${n}-${idx}`} className="font-mono">{n}</li>
                      ))}
                      {invalidNumbers.length > 200 && (
                        <li className="text-muted-foreground">... și încă {invalidNumbers.length - 200} linii</li>
                      )}
                    </ul>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2) Mesaj SMS</CardTitle>
              <CardDescription>Textul SMS-ului. Evită caracterele speciale dacă nu e necesar.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Scrie mesajul aici..."
                rows={5}
              />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                <div>
                  <label className="text-sm text-muted-foreground">Rată (mesaje/minut)</label>
                  <Input
                    type="number"
                    min={1}
                    max={300}
                    value={ratePerMinute}
                    onChange={(e) => setRatePerMinute(Math.max(1, Number(e.target.value)))}
                  />
                </div>
                <div className="flex gap-2 md:col-span-2">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      if (!numbers[0]) {
                        toast({ title: "Lipsește număr", description: "Încarcă cel puțin un număr valid." });
                        return;
                      }
                      if (!message.trim()) {
                        toast({ title: "Lipsește mesaj", description: "Scrie un mesaj pentru test." });
                        return;
                      }
                      testSend.mutate({ number: numbers[0], message });
                    }}
                  >
                    <Play className="h-4 w-4" /> Test către primul număr
                  </Button>
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex gap-2">
              <Button
                onClick={() => startBulk.mutate({ numbers, message, ratePerMinute })}
                disabled={!canStart || isSending}
              >
                <Play className="h-4 w-4" /> Pornește trimiterea
              </Button>
              <Button variant="outline" onClick={() => pauseBulk.mutate()} disabled={!isSending}>
                <Pause className="h-4 w-4" /> Pauză
              </Button>
              <Button variant="destructive" onClick={() => stopBulk.mutate()} disabled={!isSending}>
                <StopCircle className="h-4 w-4" /> Oprește
              </Button>
            </CardFooter>
          </Card>
        </section>

        <aside className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Telefon & Permisiuni</CardTitle>
              <CardDescription>Conectează prin USB, activează Debugging, apoi urmează pașii.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className={cn("flex items-center gap-2", status?.connected ? "text-foreground" : "text-muted-foreground")}> 
                <Phone className="h-4 w-4" />
                {statusLoading ? "Verific..." : status?.connected ? `Conectat: ${status?.deviceModel ?? "(necunoscut)"}` : "Neconectat"}
              </div>
              <div className={cn("flex items-center gap-2", status?.apkInstalled ? "text-foreground" : "text-muted-foreground")}>
                <FileText className="h-4 w-4" /> APK instalat: {status?.apkInstalled ? "da" : "nu"}
              </div>
              <div className={cn("flex items-center gap-2", status?.permissions?.sendSms ? "text-foreground" : "text-muted-foreground")}>
                <CheckCircle2 className="h-4 w-4" /> Permisiune SEND_SMS: {status?.permissions?.sendSms ? "da" : "nu"}
              </div>
              <Separator className="my-2" />
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => ensureAdb.mutate()} disabled={ensureAdb.isPending}>
                  Inițializează ADB
                </Button>
                <Button variant="outline" onClick={() => installApk.mutate()} disabled={installApk.isPending}>
                  Instalează APK
                </Button>
                <Button variant="outline" onClick={() => grantPerms.mutate()} disabled={grantPerms.isPending}>
                  Acordă permisiuni
                </Button>
                <Button variant="secondary" onClick={() => refetchStatus()}>Reverifică</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Loguri</CardTitle>
              <CardDescription>Evenimente și erori din procesul de trimitere.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="max-h-80 overflow-auto rounded-md border p-3 text-xs font-mono leading-relaxed">
                {(logs?.lines ?? []).length === 0 ? (
                  <div className="text-muted-foreground">Niciun log încă.</div>
                ) : (
                  (logs?.lines ?? []).map((l, idx) => <div key={idx}>{l}</div>)
                )}
              </div>
            </CardContent>
          </Card>
        </aside>
      </main>
    </div>
  );
};

export default BulkSMS;
