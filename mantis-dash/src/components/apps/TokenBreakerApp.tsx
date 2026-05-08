"use client";

import React, { useState } from "react";
import useSWR from "swr";
import { Banknote, ShieldAlert, CheckCircle, Save } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function TokenBreakerApp() {
  const { data: ledgerData } = useSWR("http://localhost:5002/api/v1/ledger", fetcher, {
    refreshInterval: 4000,
    fallbackData: { budget: 1.0, ledger: {} },
  });

  const [inputCap, setInputCap] = useState(1.0);

  const budget = ledgerData?.budget || 1.0;
  const ledger: Record<string, number> = ledgerData?.ledger || {};
  const agents = Object.entries(ledger);
  
  const totalSpend = agents.reduce((sum, [, spend]) => sum + spend, 0);
  const percentUtilized = budget > 0 ? (totalSpend / budget) * 100 : 0;
  
  const remainingBudget = Math.max(0, budget - totalSpend);

  const handleUpdateCap = () => {
    // TODO: Connect to backend when PUT /api/v1/ledger/config exists
    console.log(`Updating Hard-Cap Threshold to $${inputCap}`);
  };

  return (
    <div className="flex flex-col h-full gap-5 overflow-y-auto no-scrollbar pb-10">
      {/* Header */}
      <header className="px-2 flex items-start justify-between shrink-0">
        <div>
          <h2 className="text-[var(--foreground)] text-xl font-bold tracking-wide flex items-center gap-2">
            <Banknote className="w-6 h-6 text-[var(--accent)]" />
            TokenBreaker Financial Dashboard
          </h2>
          <p className="text-[var(--deploymantis-text-muted)] text-sm mt-1.5 font-mono">
            LLM budget enforcement and cost tracking.
          </p>
        </div>
      </header>

      {/* Budget Progress Bar */}
      <div className="glass rounded-2xl p-6 shrink-0">
        <div className="flex justify-between items-end mb-4">
          <div className="text-sm font-semibold text-[var(--foreground)] uppercase tracking-wider">
            Budget Utilization
          </div>
          <div className="text-xl font-mono text-[var(--foreground)] font-bold">
            ${totalSpend.toFixed(4)} <span className="text-[var(--deploymantis-text-muted)] text-sm font-normal">/ ${budget.toFixed(2)}</span>
          </div>
        </div>

        <div className="w-full h-4 bg-white/[0.04] rounded-full overflow-hidden border border-[var(--deploymantis-glass-border)]">
          <div
            className="h-full rounded-full transition-all duration-1000 ease-out"
            style={{
              width: `${Math.min(100, percentUtilized)}%`,
              background: percentUtilized > 85 
                ? "linear-gradient(90deg, #ef4444, #f87171)" 
                : percentUtilized > 50 
                  ? "linear-gradient(90deg, #f59e0b, #fbbf24)" 
                  : "linear-gradient(90deg, var(--deploymantis-accent-primary), #a3b89f)",
            }}
          />
        </div>
        <div className="mt-3 text-center text-xs font-mono font-bold" style={{ color: percentUtilized > 85 ? '#ef4444' : percentUtilized > 50 ? '#f59e0b' : 'var(--accent)' }}>
          {percentUtilized.toFixed(2)}%
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-5 shrink-0">
        {/* Budget Configuration Card */}
        <div className="glass-card rounded-xl p-5 lg:w-1/3 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[var(--foreground)] mb-4">Hard-Cap Threshold</h3>
            <div className="flex items-center gap-3 mb-6">
              <span className="text-[var(--deploymantis-text-muted)] font-mono text-lg">$</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={inputCap}
                onChange={(e) => setInputCap(Number(e.target.value))}
                className="w-full bg-black/20 border border-[var(--deploymantis-glass-border)] rounded-lg px-3 py-2 font-mono text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] transition-colors"
              />
            </div>
          </div>
          <button
            onClick={handleUpdateCap}
            className="w-full flex items-center justify-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent)]/80 text-white font-medium rounded-lg px-4 py-2.5 transition-colors text-sm mt-auto"
          >
            <Save className="w-4 h-4" />
            Update Cap
          </button>
        </div>

        {/* Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 lg:w-2/3">
          <div className="metric-card flex flex-col justify-center">
            <div className="text-3xl font-bold font-mono text-[var(--foreground)]">{agents.length}</div>
            <div className="text-xs text-[var(--deploymantis-text-muted)] mt-2 uppercase tracking-wider">Total Agents</div>
          </div>
          <div className="metric-card flex flex-col justify-center">
            <div className="text-3xl font-bold font-mono text-[var(--foreground)]">${totalSpend.toFixed(4)}</div>
            <div className="text-xs text-[var(--deploymantis-text-muted)] mt-2 uppercase tracking-wider">Total Spend</div>
          </div>
          <div className="metric-card flex flex-col justify-center">
            <div className="text-3xl font-bold font-mono" style={{ color: percentUtilized > 85 ? '#ef4444' : percentUtilized > 50 ? '#f59e0b' : 'var(--deploymantis-accent-primary)' }}>
              ${remainingBudget.toFixed(4)}
            </div>
            <div className="text-xs text-[var(--deploymantis-text-muted)] mt-2 uppercase tracking-wider">Budget Remaining</div>
          </div>
        </div>
      </div>

      {/* Agent Spend Table */}
      <div className="glass rounded-xl overflow-hidden shadow-2xl shrink-0 mt-2">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-black/20 text-[10px] uppercase tracking-widest text-[var(--deploymantis-text-muted)] border-b border-[var(--deploymantis-glass-border)]">
              <th className="px-5 py-3 font-medium">Agent ID</th>
              <th className="px-5 py-3 font-medium">Spend</th>
              <th className="px-5 py-3 font-medium">% of Budget</th>
              <th className="px-5 py-3 font-medium w-40">Status</th>
            </tr>
          </thead>
          <tbody>
            {agents.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-sm text-[var(--deploymantis-text-muted)]">
                  No agent activity recorded in the ledger yet.
                </td>
              </tr>
            ) : (
              agents.map(([agentId, spend]) => {
                const isBlocked = spend >= budget;
                const agentPct = budget > 0 ? (spend / budget) * 100 : 0;
                
                return (
                  <tr key={agentId} className="border-b border-[var(--deploymantis-glass-border)] hover:bg-white/[0.03] transition-colors">
                    <td className="px-5 py-3 text-sm text-[var(--foreground)] font-mono">{agentId}</td>
                    <td className="px-5 py-3 font-mono text-[13px] text-[var(--foreground)]">${spend.toFixed(4)}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-[11px] text-[var(--deploymantis-text-muted)] w-12">{agentPct.toFixed(2)}%</span>
                        <div className="flex-1 h-1.5 bg-black/30 rounded-full overflow-hidden max-w-[100px]">
                          <div
                            className="h-full rounded-full transition-all duration-500 ease-out"
                            style={{
                              width: `${Math.min(100, agentPct)}%`,
                              background: isBlocked ? "#ef4444" : agentPct > 50 ? "#f59e0b" : "var(--deploymantis-accent-primary)"
                            }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      {isBlocked ? (
                        <div className="flex items-center gap-1.5 text-xs font-bold text-red-400">
                          <ShieldAlert className="w-3.5 h-3.5" />
                          BLOCKED
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                          <CheckCircle className="w-3.5 h-3.5" />
                          Active
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
