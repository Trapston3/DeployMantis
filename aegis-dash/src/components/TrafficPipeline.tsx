"use client";

import React, { useEffect, useState } from "react";
import { ShieldCheck, Lock, Skull, Cpu, ChevronRight } from "lucide-react";

interface TrafficPipelineProps {
  /** Increment this value to trigger a new pulse animation */
  pulseKey: number;
}

const hops = [
  { id: "breaker", label: "Breaker", icon: ShieldCheck, desc: "Budget Gate" },
  { id: "vault",   label: "Vault",   icon: Lock,        desc: "PII Scrub" },
  { id: "chaos",   label: "Chaos",   icon: Skull,       desc: "Injectors" },
  { id: "env",     label: "Env",     icon: Cpu,         desc: "RL Engine" },
];

export default function TrafficPipeline({ pulseKey }: TrafficPipelineProps) {
  const [activeHop, setActiveHop] = useState(-1);

  useEffect(() => {
    if (pulseKey <= 0) return;

    let cancelled = false;
    const runPulse = async () => {
      for (let i = 0; i < hops.length; i++) {
        if (cancelled) return;
        setActiveHop(i);
        await new Promise((r) => setTimeout(r, 300));
      }
      await new Promise((r) => setTimeout(r, 400));
      if (!cancelled) setActiveHop(-1);
    };
    runPulse();
    return () => { cancelled = true; };
  }, [pulseKey]);

  return (
    <div className="flex items-center gap-0 px-4 py-6 overflow-x-auto">
      {hops.map((hop, idx) => {
        const Icon = hop.icon;
        const isActive = activeHop === idx;
        const isPast = activeHop > idx;

        return (
          <React.Fragment key={hop.id}>
            {/* Hop Node */}
            <div className="flex flex-col items-center gap-2.5 relative min-w-[72px]">
              <div
                className={`
                  relative w-14 h-14 rounded-xl flex items-center justify-center
                  transition-all duration-300 ease-out backdrop-blur-md border
                  ${isActive
                    ? "border-[var(--accent)] bg-[var(--accent)]/10 scale-110 glow-accent shadow-lg"
                    : isPast
                      ? "border-[var(--aegis-glass-border)] bg-[var(--aegis-glass-bg)]"
                      : "border-white/5 bg-black/20"
                  }
                `}
              >
                {isActive && (
                  <div className="absolute inset-0 rounded-xl border-[1.5px] border-[var(--accent)] animate-pulse-glow" />
                )}
                <Icon
                  className={`w-6 h-6 transition-colors duration-300 ${
                    isActive
                      ? "text-[var(--accent)]"
                      : isPast
                        ? "text-[var(--accent)]/60"
                        : "text-[var(--aegis-text-muted)]"
                  }`}
                />
              </div>
              <div className="text-center">
                <div
                  className={`text-[10px] font-mono uppercase tracking-widest transition-colors duration-300 ${
                    isActive ? "text-[var(--accent)] font-bold glow-dot" : "text-[var(--aegis-text-muted)]"
                  }`}
                >
                  {hop.label}
                </div>
                <div className="text-[9px] text-gray-500 font-mono mt-0.5">{hop.desc}</div>
              </div>
            </div>

            {/* Connector Arrow */}
            {idx < hops.length - 1 && (
              <div className="flex-1 flex items-center justify-center min-w-[50px] -mt-8 px-2">
                <div className="relative w-full h-[1px]">
                  <div className="absolute inset-0 bg-white/5" />
                  <div
                    className={`
                      absolute inset-y-0 left-0 bg-[var(--accent)] transition-all ease-out
                      ${activeHop > idx
                        ? "w-full duration-200 shadow-[0_0_8px_var(--aegis-accent-glow)]"
                        : activeHop === idx
                          ? "w-1/2 duration-300"
                          : "w-0 duration-100"
                      }
                    `}
                  />
                </div>
                <ChevronRight
                  className={`w-4 h-4 shrink-0 transition-colors duration-300 ml-1 ${
                    activeHop >= idx ? "text-[var(--accent)]" : "text-white/10"
                  }`}
                />
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
