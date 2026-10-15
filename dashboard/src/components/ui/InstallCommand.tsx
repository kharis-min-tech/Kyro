"use client";

import { useEffect, useState } from "react";
import { Copy, Check } from "lucide-react";

const BASE = "https://raw.githubusercontent.com/kharis-min-tech/Kyro/main/camera-box/install";

/** The one line that installs the Kyro counter. With a pairing code, it pairs by itself too. */
export function installCommand(os: "windows" | "mac", code?: string | null): string {
  if (os === "windows") {
    const run = `powershell -ExecutionPolicy Bypass -Command "irm ${BASE}/install-windows.ps1 | iex"`;
    return code ? `$env:KYRO_PAIR_CODE='${code}'; ${run}` : run;
  }
  return `curl -fsSL ${BASE}/install.sh | ${code ? `KYRO_PAIR_CODE=${code} ` : ""}bash`;
}

/** Windows / Mac tabs, the command, and a Copy button. */
export function InstallCommand({ code }: { code?: string | null }) {
  const [os, setOs] = useState<"windows" | "mac">("windows");
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (/Mac|Linux|CrOS/.test(navigator.userAgent) && !/Windows/.test(navigator.userAgent)) setOs("mac"); }, []);

  const cmd = installCommand(os, code);
  const copy = async () => {
    try { await navigator.clipboard.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  };
  const tab = (id: "windows" | "mac", label: string) => (
    <button onClick={() => setOs(id)} className="px-3 py-1.5 rounded-lg text-xs font-semibold"
      style={os === id ? { background: "#6366f1", color: "#fff" } : { background: "var(--bg-hover)", color: "#9ca3af" }}>
      {label}
    </button>
  );

  return (
    <div>
      <div className="flex gap-2">{tab("windows", "Windows")}{tab("mac", "Mac / Linux")}</div>
      <p className="text-xs mt-3" style={{ color: "#6b7280" }}>
        {os === "windows"
          ? "1. On the computer the camera plugs into, click Start, type PowerShell and open it.  2. Paste this line and press Enter:"
          : "1. On the computer the camera plugs into, open Terminal (press Cmd + Space and type Terminal).  2. Paste this line and press Enter:"}
      </p>
      <div className="mt-2 flex items-stretch gap-2">
        <code className="flex-1 min-w-0 rounded-lg px-3 py-2.5 text-xs break-all font-mono"
          style={{ background: "var(--bg-hover)", color: "var(--text-primary, #e5e7eb)" }}>
          {cmd}
        </code>
        <button onClick={copy} className="shrink-0 flex items-center gap-1.5 px-3 rounded-lg text-xs font-semibold"
          style={{ background: "#6366f1", color: "#fff" }} aria-label="Copy the command">
          {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
        </button>
      </div>
    </div>
  );
}
