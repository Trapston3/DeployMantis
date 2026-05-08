"use client";

import React, { useState, useEffect } from "react";
import useSWR from "swr";
import { Shield, CheckCircle, AlertTriangle, ScanLine, Loader2, WifiOff, CheckCircle2 } from "lucide-react";

const CORE_API_URL = process.env.NEXT_PUBLIC_CORE_API_URL || "http://localhost:4000";

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
  });

type Rule = {
  id: string;
  name: string;
  pattern: string;
  replacement: string;
  enabled: boolean;
};

type ToastState = { msg: string; type: "ok" | "err" } | null;

function Toast({ toast }: { toast: ToastState }) {
  if (!toast) return null;
  return (
    <div
      className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-2xl text-sm font-medium animate-slide-in border ${
        toast.type === "ok"
          ? "bg-emerald-900/80 border-emerald-500/30 text-emerald-300"
          : "bg-red-900/80 border-red-500/30 text-red-300"
      }`}
    >
      {toast.type === "ok" ? (
        <CheckCircle2 className="w-4 h-4" />
      ) : (
        <WifiOff className="w-4 h-4" />
      )}
      {toast.msg}
    </div>
  );
}

export default function VaultGuardApp() {
  const { data: rules, error, isLoading, mutate } = useSWR<Rule[]>(
    `${CORE_API_URL}/api/v1/vault/rules`,
    fetcher,
    { refreshInterval: 10000 }
  );

  const [testText, setTestText] = useState("");
  const [redactedText, setRedactedText] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  function showToast(msg: string, type: "ok" | "err") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  const activeCount = rules?.filter((r) => r.enabled).length || 0;

  const toggleRule = async (id: string, currentlyEnabled: boolean) => {
    try {
      const res = await fetch(`${CORE_API_URL}/api/v1/vault/rules`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ id, enabled: !currentlyEnabled }]),
      });
      if (!res.ok) throw new Error("Failed to update rule");
      mutate();
      showToast(`Rule ${currentlyEnabled ? "disabled" : "enabled"}`, "ok");
    } catch (e) {
      showToast("Failed to update rule", "err");
    }
  };

  const handleScan = async () => {
    if (!testText.trim()) return;
    setIsScanning(true);
    try {
      const res = await fetch(`${CORE_API_URL}/api/v1/vault/test-redaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: testText }),
      });
      if (!res.ok) throw new Error("Redaction failed");
      const data = await res.json();
      setRedactedText(data.scrubbed);
      showToast("Payload scanned ✓", "ok");
    } catch (e) {
      showToast("Backend unreachable", "err");
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div className="flex flex-col h-full gap-5 overflow-y-auto no-scrollbar pb-10">
      <Toast toast={toast} />

      {/* Header */}
      <header className="px-2 flex items-start justify-between shrink-0">
        <div>
          <h2 className="text-[var(--foreground)] text-xl font-bold tracking-wide flex items-center gap-2">
            <Shield className="w-6 h-6 text-[var(--accent)]" />
            VaultGuard Security Console
          </h2>
          <p className="text-[var(--deploymantis-text-muted)] text-sm mt-1.5 font-mono">
            PII redaction rules and governance metrics.
          </p>
        </div>
        {isLoading && (
          <Loader2 className="w-5 h-5 animate-spin text-[var(--deploymantis-text-muted)] mt-1" />
        )}
      </header>

      {/* Metric Cards Row */}
      <div className="flex gap-4 shrink-0">
        <div className="metric-card">
          <div className="text-2xl font-bold font-mono text-emerald-400">1,247</div>
          <div className="text-xs text-[var(--deploymantis-text-muted)] mt-1 uppercase tracking-wider">Tokens Scrubbed</div>
        </div>
        <div className="metric-card">
          <div className="text-2xl font-bold font-mono text-[var(--foreground)]">
            {isLoading ? "--" : `${activeCount}/${rules?.length}`}
          </div>
          <div className="text-xs text-[var(--deploymantis-text-muted)] mt-1 uppercase tracking-wider">Active Rules</div>
        </div>
        <div className="metric-card">
          <div className="flex items-center justify-center gap-2">
            <div className="w-3 h-3 rounded-full bg-green-500 glow-dot" />
            <div className="text-2xl font-bold font-mono text-green-500">LOW</div>
          </div>
          <div className="text-xs text-[var(--deploymantis-text-muted)] mt-1 uppercase tracking-wider">Threat Level</div>
        </div>
      </div>

      {/* Regex Rules Data Table */}
      <div className="glass rounded-xl overflow-hidden shadow-2xl shrink-0">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-black/20 text-[10px] uppercase tracking-widest text-[var(--deploymantis-text-muted)] border-b border-[var(--deploymantis-glass-border)]">
              <th className="px-5 py-3 font-medium">Rule Name</th>
              <th className="px-5 py-3 font-medium">Pattern</th>
              <th className="px-5 py-3 font-medium">Replacement</th>
              <th className="px-5 py-3 font-medium w-32">Status</th>
            </tr>
          </thead>
          <tbody>
            {error && (
              <tr>
                <td colSpan={4} className="px-5 py-10 text-center text-red-400 text-sm">
                  <WifiOff className="w-5 h-5 mx-auto mb-2" />
                  Failed to load rules from backend
                </td>
              </tr>
            )}
            {rules?.map((rule) => (
              <tr key={rule.id} className="border-b border-[var(--deploymantis-glass-border)] hover:bg-white/[0.03] transition-colors">
                <td className="px-5 py-3 text-sm text-[var(--foreground)]">{rule.name}</td>
                <td className="px-5 py-3 font-mono text-[11px] text-[var(--deploymantis-text-muted)]">
                  <div className="max-w-[200px] truncate" title={rule.pattern}>{rule.pattern}</div>
                </td>
                <td className="px-5 py-3 font-mono text-[11px] text-[var(--accent)]">{rule.replacement}</td>
                <td className="px-5 py-3">
                  <label className="flex items-center justify-between cursor-pointer w-full">
                    <div className="flex items-center gap-1.5 text-xs font-semibold">
                      {rule.enabled ? (
                        <span className="text-emerald-400 flex items-center gap-1"><CheckCircle className="w-3 h-3"/> ON</span>
                      ) : (
                        <span className="text-gray-500 flex items-center gap-1"><AlertTriangle className="w-3 h-3"/> OFF</span>
                      )}
                    </div>
                    <div className="relative inline-flex items-center">
                      <input 
                        type="checkbox" 
                        className="sr-only peer" 
                        checked={rule.enabled} 
                        onChange={() => toggleRule(rule.id, rule.enabled)} 
                      />
                      <div className="w-8 h-4 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[var(--accent)]"></div>
                    </div>
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Test Redaction Panel */}
      <div className="glass-card rounded-xl p-5 flex flex-col gap-4 min-h-[250px] shrink-0">
        <h3 className="text-sm font-semibold text-[var(--foreground)] flex items-center gap-2">
          <ScanLine className="w-4 h-4 text-[var(--accent)]" />
          Test Redaction
        </h3>
        
        <div className="flex flex-col md:flex-row gap-4 h-full">
          <div className="flex-1 flex flex-col gap-3">
            <textarea
              className="w-full flex-1 bg-black/20 border border-[var(--deploymantis-glass-border)] rounded-lg p-3 text-sm font-mono text-[var(--foreground)] placeholder:text-[var(--deploymantis-text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors resize-none min-h-[120px]"
              placeholder="Paste text to test redaction...&#10;Example: Hello my email is test@example.com"
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
            />
            <button
              onClick={handleScan}
              disabled={isScanning || !testText.trim()}
              className="bg-[var(--accent)] hover:bg-[var(--accent)]/80 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors self-start flex items-center gap-2"
            >
              {isScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />}
              Scan Payload
            </button>
          </div>
          
          <div className="flex-1 flex flex-col">
            <div className="text-[10px] uppercase tracking-widest text-[var(--deploymantis-text-muted)] mb-2">Result Output</div>
            <pre className="w-full flex-1 bg-[#0d0d0d] border border-white/10 rounded-lg p-3 text-sm font-mono text-[var(--foreground)] whitespace-pre-wrap overflow-y-auto min-h-[120px]">
              {redactedText || <span className="text-gray-600 italic">Waiting for input...</span>}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
