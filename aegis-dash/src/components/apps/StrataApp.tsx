"use client";

import { useCallback, useState } from "react";
import TemporalScrubber from "@/components/TemporalScrubber";
import TrafficPipeline from "@/components/TrafficPipeline";
import SettingsModal from "@/components/SettingsModal";
import { Workflow, Settings, AlertTriangle } from "lucide-react";
import { detectSystemicFailure } from "@/lib/incident_correlation";

export default function StrataApp() {
  const [pulseKey, setPulseKey] = useState(0);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSystemicFailure, setIsSystemicFailure] = useState(false);

  const handleNewFrame = useCallback(() => {
    setPulseKey((k) => k + 1);
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleFramesUpdated = useCallback((frames: any[]) => {
    setIsSystemicFailure(detectSystemicFailure(frames));
  }, []);

  return (
    <div className="flex flex-col h-full gap-5">
      <header className="px-2 flex items-start justify-between">
        <div>
          <h2 className="text-[var(--foreground)] text-xl font-bold tracking-wide flex items-center gap-2">
            Temporal Debugger Workspace
          </h2>
          <p className="text-[var(--aegis-text-muted)] text-sm mt-1.5 font-mono">Live frame-by-frame analysis of Aegis reliability events.</p>
        </div>
        <button
          onClick={() => setIsSettingsOpen(true)}
          className="p-2.5 rounded-xl glass-card text-[var(--aegis-text-muted)] hover:text-[var(--foreground)] transition-all duration-300 hover:rotate-90 hover:scale-110"
          title="Settings"
        >
          <Settings className="w-5 h-5" />
        </button>
      </header>

      {/* Incident Response Banner */}
      {isSystemicFailure && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3.5 flex items-center gap-3 text-red-400 animate-slide-in shadow-[0_0_20px_rgba(239,68,68,0.15)]">
          <AlertTriangle className="w-5 h-5 shrink-0 animate-pulse" />
          <div className="text-sm">
            <strong className="font-bold tracking-widest uppercase text-red-500">Systemic Failure Detected:</strong> 
            <span className="ml-2 text-red-300">SwarmChaos has successfully compromised the pipeline with multiple consecutive 502/529 errors.</span>
          </div>
        </div>
      )}

      {/* Traffic Pipeline Visualization */}
      <div className="glass rounded-xl overflow-hidden shadow-2xl">
        <div className="flex items-center gap-2 px-4 pt-4 text-[var(--accent)] font-semibold uppercase tracking-widest text-xs border-b border-[var(--aegis-glass-border)] pb-3 bg-black/5">
          <Workflow className="w-4 h-4" />
          Traffic Pipeline
        </div>
        <TrafficPipeline pulseKey={pulseKey} />
      </div>

      {/* Temporal Debugger Feed */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
        {/* Soft glow behind the scrubber */}
        <div className="absolute inset-0 bg-[var(--accent)]/5 blur-3xl -z-10 rounded-full" />
        <TemporalScrubber onNewFrame={handleNewFrame} onFramesUpdated={handleFramesUpdated} />
      </div>

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  );
}
