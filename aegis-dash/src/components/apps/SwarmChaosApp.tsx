"use client";

import React, { useEffect, useState } from "react";
import useSWR from "swr";
import {
  Network,
  ShieldAlert,
  BrainCircuit,
  Timer,
  Skull,
  Play,
  Loader2,
  WifiOff,
  CheckCircle2,
} from "lucide-react";

const CORE_API_URL =
  process.env.NEXT_PUBLIC_CORE_API_URL || "http://localhost:4000";

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
  });

type Toggles = {
  amnesia: boolean;
  badGateway: boolean;
  hallucination: boolean;
  latency: boolean;
};

type ChaosConfig = {
  injectionRate: number;
  toggles: Toggles;
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

export default function SwarmChaosApp() {
  const {
    data: remoteConfig,
    error,
    isLoading,
    mutate,
  } = useSWR<ChaosConfig>(`${CORE_API_URL}/api/v1/chaos/config`, fetcher, {
    refreshInterval: 5000,
  });

  // Local mirror of the config — keeps UI snappy while PUT is in-flight
  const [injectionRate, setInjectionRate] = useState(10);
  const [toggles, setToggles] = useState<Toggles>({
    amnesia: true,
    badGateway: true,
    hallucination: false,
    latency: false,
  });
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  // Sync local state when remote data arrives
  useEffect(() => {
    if (remoteConfig) {
      setInjectionRate(remoteConfig.injectionRate);
      setToggles(remoteConfig.toggles);
    }
  }, [remoteConfig]);

  function showToast(msg: string, type: "ok" | "err") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  async function pushConfig(
    newRate: number = injectionRate,
    newToggles: Toggles = toggles
  ) {
    setSyncing(true);
    try {
      const res = await fetch(`${CORE_API_URL}/api/v1/chaos/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ injectionRate: newRate, toggles: newToggles }),
      });
      if (!res.ok) throw new Error(await res.text());
      await mutate();
      showToast("Config updated ✓", "ok");
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      showToast(`Backend unreachable — ${errMsg}`, "err");
    } finally {
      setSyncing(false);
    }
  }

  function handleRateCommit() {
    pushConfig(injectionRate, toggles);
  }

  function handleToggle(key: keyof Toggles) {
    const next = { ...toggles, [key]: !toggles[key] };
    setToggles(next);
    pushConfig(injectionRate, next);
  }

  // ── Derive stats from remote state ────────────────────────
  const injections = remoteConfig
    ? {
        bottleneck: Math.round(injectionRate * 0.45),
        amnesia: remoteConfig.toggles.amnesia
          ? Math.round(injectionRate * 0.28)
          : 0,
        hallucination: remoteConfig.toggles.hallucination
          ? Math.round(injectionRate * 0.12)
          : 0,
        gateway: remoteConfig.toggles.badGateway
          ? Math.round(injectionRate * 0.72)
          : 0,
      }
    : { bottleneck: 0, amnesia: 0, hallucination: 0, gateway: 0 };

  const totalInjections = Object.values(injections).reduce((s, v) => s + v, 0);
  const maxInjection = Math.max(...Object.values(injections), 1);

  return (
    <div className="flex flex-col h-full gap-5 overflow-y-auto no-scrollbar pb-10">
      <Toast toast={toast} />

      {/* Header */}
      <header className="px-2 flex items-start justify-between shrink-0">
        <div>
          <h2 className="text-[var(--foreground)] text-xl font-bold tracking-wide flex items-center gap-2">
            <Network className="w-6 h-6 text-[var(--accent)]" />
            SwarmChaos Control Panel
          </h2>
          <p className="text-[var(--aegis-text-muted)] text-sm mt-1.5 font-mono">
            Live chaos injection parameters — changes propagate to the cluster
            immediately.
          </p>
        </div>
        {isLoading && (
          <Loader2 className="w-5 h-5 animate-spin text-[var(--aegis-text-muted)] mt-1" />
        )}
        {error && !isLoading && (
          <div className="flex items-center gap-1.5 text-xs text-red-400 bg-red-900/20 border border-red-500/20 rounded-lg px-3 py-1.5">
            <WifiOff className="w-3.5 h-3.5" />
            Backend unreachable
          </div>
        )}
      </header>

      {/* Controls */}
      <div className="grid grid-cols-2 gap-5 shrink-0">
        {/* Injection Rate */}
        <div className="glass-card rounded-xl p-5 flex flex-col justify-center">
          <div className="flex justify-between items-center mb-4">
            <div>
              <div className="text-sm font-semibold text-[var(--foreground)]">
                Global Injection Rate
              </div>
              <div className="text-xs text-[var(--aegis-text-muted)]">
                Probability of chaos on any request
              </div>
            </div>
            <div className="flex items-center gap-2">
              {syncing && (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--aegis-text-muted)]" />
              )}
              <div className="text-xl font-mono text-[var(--accent)] font-bold">
                {injectionRate}%
              </div>
            </div>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={injectionRate}
            onChange={(e) => setInjectionRate(Number(e.target.value))}
            onMouseUp={handleRateCommit}
            onTouchEnd={handleRateCommit}
            className="w-full h-2 bg-black/30 rounded-lg appearance-none cursor-pointer accent-[var(--accent)] mt-2"
          />
          <div className="flex justify-between text-[10px] text-[var(--aegis-text-muted)] px-1 mt-2">
            <span>0%</span>
            <span>50%</span>
            <span>100%</span>
          </div>
        </div>

        {/* Active Injectors */}
        <div className="glass-card rounded-xl p-5">
          <h3 className="text-sm font-semibold text-[var(--foreground)] mb-4">
            Active Injectors
          </h3>
          <div className="grid grid-cols-2 gap-4">
            {(
              [
                {
                  key: "amnesia",
                  label: "Amnesia (529)",
                  Icon: BrainCircuit,
                  color: "text-red-400",
                },
                {
                  key: "badGateway",
                  label: "Bad Gateway (502)",
                  Icon: ShieldAlert,
                  color: "text-rose-500",
                },
                {
                  key: "hallucination",
                  label: "Hallucination (LLM)",
                  Icon: Skull,
                  color: "text-purple-400",
                },
                {
                  key: "latency",
                  label: "Latency Spike",
                  Icon: Timer,
                  color: "text-amber-400",
                },
              ] as const
            ).map(({ key, label, Icon, color }) => (
              <label
                key={key}
                className="flex items-center justify-between cursor-pointer"
              >
                <div
                  className={`flex items-center gap-2 text-sm text-[var(--foreground)]`}
                >
                  <Icon className={`w-4 h-4 ${color}`} />
                  {label}
                </div>
                <div className="relative inline-flex items-center">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={toggles[key]}
                    onChange={() => handleToggle(key)}
                    disabled={syncing}
                  />
                  <div className="w-9 h-5 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--accent)]" />
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Injection Bar Chart */}
      <div className="glass rounded-xl p-5 flex-1 min-h-[250px] flex flex-col">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-[var(--accent)] font-semibold uppercase tracking-widest text-xs flex items-center gap-2">
            <Network className="w-4 h-4" />
            Estimated Injections (based on current rate)
          </h3>
          <button
            onClick={() => mutate()}
            className="flex items-center gap-2 px-3 py-1.5 bg-[var(--accent)] hover:bg-[var(--accent)]/80 text-white rounded-lg text-xs font-medium transition-colors"
          >
            <Play className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>

        <div className="flex-1 flex flex-col justify-center space-y-6 px-4">
          {[
            {
              key: "bottleneck",
              label: "Latency",
              count: injections.bottleneck,
              color: "bg-amber-500",
            },
            {
              key: "amnesia",
              label: "Amnesia",
              count: injections.amnesia,
              color: "bg-red-500",
            },
            {
              key: "hallucination",
              label: "Hallucination",
              count: injections.hallucination,
              color: "bg-purple-500",
            },
            {
              key: "gateway",
              label: "502/529",
              count: injections.gateway,
              color: "bg-rose-600",
            },
          ].map((item) => (
            <div key={item.key} className="flex items-center gap-4">
              <div className="w-32 text-right text-xs font-mono text-[var(--aegis-text-muted)] truncate">
                {item.label}
              </div>
              <div className="flex-1 h-6 bg-black/20 rounded-md overflow-hidden relative border border-white/5">
                <div
                  className={`h-full ${item.color} rounded-md transition-all duration-700 ease-out`}
                  style={{
                    width: `${Math.max((item.count / maxInjection) * 100, item.count > 0 ? 2 : 0)}%`,
                  }}
                />
              </div>
              <div className="w-12 text-sm font-bold text-[var(--foreground)] font-mono">
                {item.count}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Metric Cards */}
      <div className="flex gap-4 shrink-0">
        <div className="metric-card">
          <div className="text-2xl font-bold font-mono text-[var(--foreground)]">
            {totalInjections}
          </div>
          <div className="text-xs text-[var(--aegis-text-muted)] mt-1 uppercase tracking-wider">
            Total Injections
          </div>
        </div>
        <div className="metric-card">
          <div className="text-2xl font-bold font-mono text-emerald-400">
            {injectionRate > 0 ? Math.max(0, 100 - injectionRate) : 100}%
          </div>
          <div className="text-xs text-[var(--aegis-text-muted)] mt-1 uppercase tracking-wider">
            Clean Pass Rate
          </div>
        </div>
        <div className="metric-card">
          <div
            className={`text-2xl font-bold font-mono ${error ? "text-red-400" : "text-[var(--accent)]"}`}
          >
            {error ? "OFFLINE" : syncing ? "SYNCING" : "LIVE"}
          </div>
          <div className="text-xs text-[var(--aegis-text-muted)] mt-1 uppercase tracking-wider">
            Backend Status
          </div>
        </div>
      </div>
    </div>
  );
}
