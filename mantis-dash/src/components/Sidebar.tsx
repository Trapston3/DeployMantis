"use client";

import React, { useState } from "react";
import useSWR from "swr";
import {
  Server,
  Activity,
  Network,
  Shield,
  Banknote,
  Cpu,
  RotateCw,
  Play,
  Loader2,
} from "lucide-react";

import * as Tooltip from "@radix-ui/react-tooltip";
import { useSettings, AppId } from "./SettingsContext";

const CORE_API_URL =
  process.env.NEXT_PUBLIC_CORE_API_URL || "http://localhost:4000";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface ServiceInfo {
  name: string;
  status: "online" | "offline" | "degraded" | "unknown";
  container?: string;
}

const SERVICE_ICONS: Record<string, React.ElementType> = {
  strata: Server,
  "mantis-env": Activity,
  "swarm-chaos": Network,
  "vault-guard": Shield,
  "token-breaker": Banknote,
  "mantis-dash": Monitor,
  "core-api": Cpu,
};

const SERVICE_LABELS: Record<string, string> = {
  strata: "Strata",
  "mantis-env": "MantisEnv",
  "core-api": "Core API",
  "swarm-chaos": "SwarmChaos",
  "vault-guard": "VaultGuard",
  "token-breaker": "TokenBreaker",
  "mantis-dash": "MantisDash",
};

const SERVICE_DESCRIPTIONS: Record<string, string> = {
  strata: "Instruments HTTP traffic and exports structured logs & metrics.",
  "mantis-env": "RL Survival Environment validating agent logic.",
  "swarm-chaos": "Intelligent Saboteur. Injects hallucinations & bottlenecks.",
  "vault-guard": "Zero-trust privacy redactor. Scrubs PII from outbound payloads.",
  "token-breaker": "Real-time financial circuit breaker enforcing AI budget caps.",
  "core-api": "Central API gateway and orchestration layer.",
  "mantis-dash": "Enterprise SRE Dashboard.",
};

const STATUS_COLORS: Record<string, string> = {
  online: "text-emerald-400",
  offline: "text-red-400",
  degraded: "text-amber-400",
  unknown: "text-gray-500",
};

export default function Sidebar() {
  const { data: statusData, mutate: refetchStatus } = useSWR(
    `${CORE_API_URL}/api/v1/orchestrator/status`,
    fetcher,
    { refreshInterval: 5000, fallbackData: { services: [] } }
  );

  const { data: ledgerData } = useSWR(
    "http://localhost:5002/api/v1/ledger",
    fetcher,
    { refreshInterval: 4000, fallbackData: { budget: 1.0, ledger: {} } }
  );

  const { data: statsData } = useSWR(
    `${CORE_API_URL}/api/v1/orchestrator/stats`,
    fetcher,
    { refreshInterval: 5000, fallbackData: { stats: [] } }
  );

  const [loadingSvc, setLoadingSvc] = useState<string | null>(null);

  const { activeApp, setActiveApp } = useSettings();

  const services: ServiceInfo[] = statusData?.services || [];
  const budget = ledgerData?.budget || 1.0;
  const ledger: Record<string, number> = ledgerData?.ledger || {};
  const totalSpend = Object.values(ledger).reduce((a: number, b: number) => a + b, 0);
  const pct = Math.min(100, (totalSpend / budget) * 100);
  const nodeStats = statsData?.stats || [];

  const handleAction = async (name: string, action: "restart" | "start") => {
    setLoadingSvc(name);
    try {
      await fetch(
        `${CORE_API_URL}/api/v1/orchestrator/${action}/${name}`,
        { method: "POST" }
      );
      setTimeout(() => refetchStatus(), 2000);
    } catch (e) {
      console.error(`Failed to ${action} ${name}`, e);
    } finally {
      setTimeout(() => setLoadingSvc(null), 2500);
    }
  };

  return (
    <aside className="w-[260px] min-w-[240px] glass flex flex-col p-4 gap-6 shrink-0 border-r-0 rounded-r-2xl">
      {/* Logo */}
      <div className="pt-1">
        <h1 className="text-xl font-bold tracking-widest text-[var(--foreground)] uppercase">
          Mantis<span className="text-[var(--accent)]">Suite</span>
        </h1>
        <p className="text-[10px] text-[var(--mantis-text-muted)] tracking-[0.2em] mt-0.5">
          COMMAND CENTER
        </p>
      </div>

      {/* Main Content */}
      <div className="flex-1 space-y-5 overflow-y-auto no-scrollbar">
        {/* Apps Launcher */}
        <div>
          <h2 className="text-[10px] uppercase tracking-[0.2em] text-[var(--deploymantis-text-muted)] mb-3 pb-1 border-b border-[var(--deploymantis-glass-border)]">
            Apps
          </h2>
          <ul className="space-y-1.5">
            {[
              { id: "strata", label: "Strata Timeline", icon: Activity },
              { id: "swarm-chaos", label: "SwarmChaos", icon: Network },
              { id: "vault-guard", label: "VaultGuard", icon: Shield },
              { id: "token-breaker", label: "TokenBreaker", icon: Banknote },
            ].map((app) => {
              const Icon = app.icon;
              const isActive = activeApp === app.id;
              return (
                <li key={app.id}>
                  <button
                    onClick={() => setActiveApp(app.id as AppId)}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all duration-200 ${
                      isActive
                        ? "bg-[var(--accent)]/15 border-l-2 border-l-[var(--accent)] text-[var(--accent)] glass-subtle shadow-[inset_0_0_20px_rgba(138,154,134,0.1)]"
                        : "glass-subtle text-[var(--foreground)] hover:bg-white/[0.03] border-l-2 border-l-transparent"
                    }`}
                  >
                    <Icon className={`w-3.5 h-3.5 ${isActive ? "text-[var(--accent)]" : "text-[var(--deploymantis-text-muted)]"}`} />
                    <span className="text-sm font-medium">{app.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Health Matrix */}
        <div>
          <h2 className="text-[10px] uppercase tracking-[0.2em] text-[var(--deploymantis-text-muted)] mb-3 pb-1 border-b border-[var(--deploymantis-glass-border)]">
            Global Health Matrix
          </h2>
          <ul className="space-y-1.5">
            {services.map((svc) => {
              const Icon = SERVICE_ICONS[svc.name] || Server;
              const label = SERVICE_LABELS[svc.name] || svc.name;
              const isLoading = loadingSvc === svc.name;
              const isOffline = svc.status === "offline";
              const isSelf = svc.name === "core-api";

              return (
                <Tooltip.Provider key={svc.name}>
                  <Tooltip.Root delayDuration={300}>
                    <Tooltip.Trigger asChild>
                      <li
                        className="group flex items-center justify-between px-2.5 py-2 rounded-lg glass-subtle hover:bg-white/[0.03] transition-all duration-200 cursor-help"
                      >
                        <div className="flex items-center gap-2.5">
                          <Icon className="w-3.5 h-3.5 text-[var(--deploymantis-text-muted)]" />
                          <span className="text-sm text-[var(--foreground)] font-medium">
                            {label}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {/* Action button — visible on hover for online, always for offline */}
                          {!isSelf && (
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                handleAction(
                                  svc.name,
                                  isOffline ? "start" : "restart"
                                );
                              }}
                              disabled={isLoading}
                              className={`
                                p-1 rounded transition-all duration-200 
                                ${isOffline
                                  ? "opacity-100"
                                  : "opacity-0 group-hover:opacity-100"
                                }
                                hover:bg-[var(--accent)]/10 text-[var(--deploymantis-text-muted)] hover:text-[var(--accent)]
                                disabled:opacity-30
                              `}
                              title={isOffline ? "Start" : "Restart"}
                            >
                              {isLoading ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : isOffline ? (
                                <Play className="w-3 h-3" />
                              ) : (
                                <RotateCw className="w-3 h-3" />
                              )}
                            </button>
                          )}
                          {/* Status dot */}
                          <div
                            className={`w-2 h-2 rounded-full glow-dot ${STATUS_COLORS[svc.status]}`}
                          />
                        </div>
                      </li>
                    </Tooltip.Trigger>
                    <Tooltip.Portal>
                      <Tooltip.Content
                        side="right"
                        sideOffset={15}
                        className="glass-card z-50 text-xs text-[var(--foreground)] p-2.5 rounded-lg max-w-[200px] shadow-2xl animate-slide-in font-sans leading-relaxed"
                      >
                        {SERVICE_DESCRIPTIONS[svc.name] || "Mantis Microservice."}
                        <Tooltip.Arrow className="fill-[var(--mantis-glass-border)]" />
                      </Tooltip.Content>
                    </Tooltip.Portal>
                  </Tooltip.Root>
                </Tooltip.Provider>
              );
            })}
            {services.length === 0 && (
              <li className="text-xs text-[var(--deploymantis-text-muted)] px-2 py-4 text-center">
                Connecting to orchestrator...
              </li>
            )}
          </ul>
        </div>

        {/* Ledger */}
        <div>
          <h2 className="text-[10px] uppercase tracking-[0.2em] text-[var(--deploymantis-text-muted)] mb-3 pb-1 border-b border-[var(--deploymantis-glass-border)]">
            Ledger Status
          </h2>
          <div className="glass-card rounded-xl p-3.5 space-y-3">
            {Object.entries(ledger).length > 0 ? (
              Object.entries(ledger).map(([agent, spend]) => {
                const agentPct = Math.min(100, ((spend as number) / budget) * 100);
                return (
                  <div key={agent} className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-[var(--deploymantis-text-muted)] font-mono truncate max-w-[120px]">
                        {agent}
                      </span>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-sm font-mono text-[var(--foreground)] font-semibold">
                          ${(spend as number).toFixed(4)}
                        </span>
                        <span className="text-[9px] text-[var(--deploymantis-text-muted)]">
                          / ${budget.toFixed(2)}
                        </span>
                      </div>
                    </div>
                    <div className="w-full bg-white/[0.04] h-1 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700 ease-out"
                        style={{
                          width: `${agentPct}%`,
                          background: agentPct > 85
                            ? "linear-gradient(90deg, #ef4444, #f87171)"
                            : agentPct > 50
                              ? "linear-gradient(90deg, #f59e0b, #fbbf24)"
                              : "linear-gradient(90deg, var(--deploymantis-accent-primary), #a3b89f)",
                        }}
                      />
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="text-xs text-[var(--deploymantis-text-muted)] text-center py-2">
                No agent activity yet
              </p>
            )}
          </div>
        </div>

        {/* SpeedFan Node Monitor */}
        {nodeStats.length > 0 && (
          <div>
            <h2 className="text-[10px] uppercase tracking-[0.2em] text-[var(--deploymantis-text-muted)] mb-3 pb-1 border-b border-[var(--deploymantis-glass-border)]">
              SpeedFan Monitor
            </h2>
            <div className="glass-card rounded-xl p-3.5 space-y-3 max-h-[160px] overflow-y-auto no-scrollbar">
              {nodeStats.map((stat: any) => (
                <div key={stat.name} className="space-y-1.5">
                  <div className="flex justify-between items-center text-[10px]">
                    <span className="text-[var(--foreground)] font-mono truncate max-w-[100px]">{stat.name}</span>
                    <span className="text-[var(--deploymantis-text-muted)] font-mono text-[9px]">C:{stat.cpu_percent}% M:{stat.mem_percent}%</span>
                  </div>
                  <div className="flex gap-1 h-1">
                    <div className="flex-1 bg-white/[0.04] rounded-l overflow-hidden">
                      <div
                        className="h-full rounded-l transition-all duration-700 ease-out"
                        style={{
                          width: `${Math.min(100, stat.cpu_percent)}%`,
                          background: stat.cpu_percent > 85 ? "#ef4444" : stat.cpu_percent > 50 ? "#f59e0b" : "var(--deploymantis-accent-primary)"
                        }}
                      />
                    </div>
                    <div className="flex-1 bg-white/[0.04] rounded-r overflow-hidden">
                      <div
                        className="h-full rounded-r transition-all duration-700 ease-out"
                        style={{
                          width: `${Math.min(100, stat.mem_percent)}%`,
                          background: stat.mem_percent > 85 ? "#ef4444" : stat.mem_percent > 50 ? "#f59e0b" : "#60a5fa"
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="text-[9px] text-[var(--mantis-text-muted)] font-mono leading-relaxed opacity-60">
        SYS.STATUS // NOMINAL
        <br />
        {new Date().toISOString().split("T")[0]}
      </div>
    </aside>
  );
}
