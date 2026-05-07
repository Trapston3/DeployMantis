"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import useSWR from "swr";
import { Virtuoso } from "react-virtuoso";
import { Terminal, Trash2, AlertTriangle, ShieldAlert, ChevronRight, ChevronDown, Activity, Code, Shield, Play, Copy, Download } from "lucide-react";
import { useSettings } from "./SettingsContext";
import JsonViewer from "./JsonViewer";

const CORE_API_URL = process.env.NEXT_PUBLIC_CORE_API_URL || "http://localhost:4000";
const fetcher = (url: string) => fetch(url).then((res) => res.json());

interface TemporalScrubberProps {
  onNewFrame?: () => void;
  onFramesUpdated?: (frames: any[]) => void;
}

type FilterType = "All" | "Chaos Events" | "Governance Redactions" | "System Errors";

export default function TemporalScrubber({ onNewFrame, onFramesUpdated }: TemporalScrubberProps) {
  const { pollingInterval, autoPurge, dataVerbosity, isPaused, timestampFormat } = useSettings();
  
  const { data, error, mutate } = useSWR(`${CORE_API_URL}/api/v1/strata/debugger/frames`, fetcher, {
    refreshInterval: isPaused ? 0 : pollingInterval,
  });

  const [isPurging, setIsPurging] = useState(false);
  const [expandedFrames, setExpandedFrames] = useState<Set<string | number>>(new Set());
  const [filter, setFilter] = useState<FilterType>("All");
  
  const prevSizeRef = useRef<number>(0);

  const frames = data?.frames || [];
  const currentSize = data?.currentSize || 0;
  const capacity = data?.capacity || 50;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const traceId = params.get("traceId");
    if (traceId) {
      setExpandedFrames(new Set([traceId]));
    }
  }, []);

  useEffect(() => {
    onFramesUpdated?.(frames);
  }, [frames, onFramesUpdated]);

  useEffect(() => {
    if (currentSize > prevSizeRef.current && prevSizeRef.current > 0) {
      onNewFrame?.();
    }
    prevSizeRef.current = currentSize;
    
    // Auto-Purge feature
    if (autoPurge && currentSize >= capacity && capacity > 0 && !isPurging) {
      handlePurge();
    }
  }, [currentSize, onNewFrame, autoPurge, capacity]);

  const handlePurge = async () => {
    setIsPurging(true);
    try {
      await fetch(`${CORE_API_URL}/api/v1/strata/debugger/frames`, { method: "DELETE" });
      mutate();
    } catch (err) {
      console.error("Failed to purge buffer", err);
    } finally {
      setIsPurging(false);
    }
  };

  const toggleFrame = (id: string | number) => {
    setExpandedFrames((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        const url = new URL(window.location.href);
        url.searchParams.delete("traceId");
        window.history.replaceState({}, "", url);
      } else {
        next.add(id);
        const url = new URL(window.location.href);
        url.searchParams.set("traceId", id.toString());
        window.history.replaceState({}, "", url);
      }
      return next;
    });
  };

  const handleReplay = async (frame: any, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const options: RequestInit = {
        method: frame.method || "POST",
        headers: frame.headers || { "Content-Type": "application/json" },
      };
      if (frame.body && frame.method !== "GET" && frame.method !== "HEAD") {
        options.body = typeof frame.body === "string" ? frame.body : JSON.stringify(frame.body);
      }
      await fetch(`${CORE_API_URL}/api/v1/strata${frame.path}`, options);
      setTimeout(() => mutate(), 500);
    } catch (err) {
      console.error("Replay failed", err);
    }
  };

  const handleCopyCurl = (frame: any, e: React.MouseEvent) => {
    e.stopPropagation();
    let curl = `curl -X ${frame.method || "POST"} "${CORE_API_URL}/api/v1/strata${frame.path}"`;
    if (frame.headers) {
      for (const [key, val] of Object.entries(frame.headers)) {
        curl += ` \\\n  -H "${key}: ${val}"`;
      }
    }
    if (frame.body && frame.method !== "GET" && frame.method !== "HEAD") {
      const bodyStr = typeof frame.body === "string" ? frame.body : JSON.stringify(frame.body);
      curl += ` \\\n  -d '${bodyStr.replace(/'/g, "'\\''")}'`;
    }
    navigator.clipboard.writeText(curl);
  };

  const handleExportTrace = (frame: any, e: React.MouseEvent) => {
    e.stopPropagation();
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(frame, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", `aegis-trace-${frame.id || 'export'}.json`);
    dlAnchorElem.click();
  };

  const formatTimestamp = (ts: string) => {
    if (!ts) return "";
    if (timestampFormat === "relative") {
      // eslint-disable-next-line react-hooks/purity
      const diff = Date.now() - new Date(ts).getTime();
      const seconds = Math.floor(diff / 1000);
      if (seconds < 60) return `${seconds}s ago`;
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return `${minutes}m ago`;
      const hours = Math.floor(minutes / 60);
      return `${hours}h ago`;
    }
    try {
      return new Date(ts).toISOString().split("T")[1].replace("Z", "");
    } catch {
      return ts;
    }
  };

  const filteredFrames = useMemo(() => {
    const reversed = [...frames].reverse();
    if (filter === "All") return reversed;
    
    return reversed.filter(frame => {
      const isChaos = frame.statusCode === 502 || frame.statusCode === 529 || frame.message?.includes("Chaos");
      const isGov = frame.message?.includes("VaultGuard") || frame.message?.includes("TokenBreaker") || frame.message?.includes("REDACTED");
      const isError = frame.statusCode >= 500;
      
      if (filter === "Chaos Events") return isChaos;
      if (filter === "Governance Redactions") return isGov;
      if (filter === "System Errors") return isError && !isChaos;
      return true;
    });
  }, [frames, filter]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--foreground)] opacity-50 glass rounded-xl shadow-2xl">
        <ShieldAlert className="w-12 h-12 mb-4 text-red-500 animate-pulse-glow" />
        <p className="font-mono text-sm">Connection lost to Strata Temporal Debugger.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full glass rounded-xl overflow-hidden font-mono text-sm shadow-2xl">
      {/* Header */}
      <div className="flex flex-col border-b border-[var(--aegis-glass-border)] bg-black/5">
        <div className="flex items-center justify-between p-4 pb-2">
          <div className="flex items-center gap-2 text-[var(--accent)] font-semibold uppercase tracking-wider text-xs">
            <Activity className="w-4 h-4 animate-pulse-glow" />
            Timeline View
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-[var(--aegis-text-muted)] bg-black/5 px-2 py-1 rounded-md border border-[var(--aegis-glass-border)]">
              Buffer: <span className="text-[var(--foreground)]">{currentSize}</span> / {capacity}
            </span>
            <button
              onClick={handlePurge}
              disabled={isPurging}
              className="flex items-center gap-1.5 px-3 py-1 text-xs text-red-500 border border-red-500/30 rounded-lg hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/50 transition-all duration-300 disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {isPurging ? "Purging..." : "Purge"}
            </button>
          </div>
        </div>
        
        {/* Filters */}
        <div className="px-4 pb-3 pt-1 flex gap-2 overflow-x-auto no-scrollbar">
          {(["All", "Chaos Events", "Governance Redactions", "System Errors"] as FilterType[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 text-[10px] uppercase font-bold rounded-md tracking-wider whitespace-nowrap transition-all border ${
                filter === f 
                  ? "bg-[var(--accent)]/20 text-[var(--accent)] border-[var(--accent)] shadow-[0_0_10px_var(--aegis-accent-glow)]" 
                  : "bg-black/10 text-[var(--aegis-text-muted)] border-[var(--aegis-glass-border)] hover:bg-white/5 hover:text-[var(--foreground)]"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      
      {/* Body: Virtualized List */}
      <div className="flex-1 min-h-0 bg-transparent" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {filteredFrames.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-[var(--aegis-text-muted)] gap-3 animate-slide-in">
            <Activity className="w-8 h-8 opacity-20" />
            <p>No frames match current filter.</p>
          </div>
        ) : (
          <Virtuoso
            style={{ height: '100%', width: '100%' }}
            data={filteredFrames}
            itemContent={(index, frame) => {
              const isChaos = frame.statusCode === 502 || frame.statusCode === 529 || frame.message?.includes("Chaos");
              const isGov = frame.message?.includes("VaultGuard") || frame.message?.includes("TokenBreaker") || frame.message?.includes("REDACTED");
              const isError = frame.statusCode >= 400 && !isChaos;
              const frameId = frame.id || index;
              const isExpanded = expandedFrames.has(frameId);
              
              return (
                <div className="px-4 py-2" style={{ display: 'flex', flexDirection: 'column' }}>
                  <div 
                    className={`glass-card rounded-xl overflow-hidden cursor-pointer border-l-4 transition-all duration-300 hover:-translate-y-0.5 ${
                      isChaos ? "border-l-red-500" : isGov ? "border-l-blue-500" : isError ? "border-l-amber-500" : "border-l-[var(--accent)]"
                    }`}
                    onClick={() => toggleFrame(frameId)}
                    style={{ flex: '0 0 auto' }}
                  >
                    <div className="p-3.5 flex items-start gap-3">
                      <div className="mt-0.5 opacity-50 shrink-0 text-[var(--foreground)]">
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-center mb-2">
                          <div className="flex items-center gap-2">
                            <span className={`text-[9px] uppercase font-bold tracking-widest px-2 py-0.5 rounded-sm ${
                              frame.statusCode >= 500 ? 'bg-red-500 text-white' : frame.statusCode >= 400 ? 'bg-amber-500 text-white' : 'bg-green-500 text-white'
                            }`}>
                              {frame.statusCode}
                            </span>
                            <span className={`text-[9px] uppercase font-bold tracking-widest px-2 py-0.5 rounded-sm ${
                              isChaos ? 'bg-red-500/20 text-red-500' : isGov ? 'bg-blue-500/20 text-blue-400' : isError ? 'bg-amber-500/20 text-amber-500' : 'bg-black/20 text-[var(--aegis-text-muted)]'
                            }`}>
                              {frame.level || 'INFO'}
                            </span>
                            <span className="text-[10px] text-[var(--aegis-text-muted)]">{formatTimestamp(frame.timestamp)}</span>
                          </div>
                          {frame.latencyMs && (
                            <span className="text-[10px] text-[var(--aegis-text-muted)] bg-black/10 border border-[var(--aegis-glass-border)] px-1.5 py-0.5 rounded shadow-sm">{frame.latencyMs}ms</span>
                          )}
                        </div>
                        <div className={`flex items-center gap-2 text-[13px] ${
                          isChaos ? "text-red-400" : isGov ? "text-blue-400" : isError ? "text-amber-500" : "text-[var(--foreground)]"
                        }`}>
                          {isChaos && <AlertTriangle className="w-4 h-4 shrink-0" />}
                          {isGov && <Shield className="w-4 h-4 shrink-0" />}
                          <span className="truncate">{frame.message}</span>
                        </div>
                      </div>
                    </div>
                    
                    {/* Expanded Content */}
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-2 bg-black/10 border-t border-[var(--aegis-glass-border)] cursor-text" onClick={(e) => e.stopPropagation()}>
                        {dataVerbosity === "Developer Mode" ? (
                          <div className="space-y-2 mt-2 animate-slide-in">
                            <div className="flex justify-between items-center mb-2 border-b border-[var(--aegis-glass-border)] pb-2">
                              <div className="flex items-center gap-2 text-[10px] uppercase text-[var(--accent)] font-bold tracking-widest opacity-80">
                                <Code className="w-3 h-3" /> Raw Telemetry
                              </div>
                              <div className="flex items-center gap-2">
                                <button onClick={(e) => handleReplay(frame, e)} className="flex items-center gap-1 px-2 py-1 bg-black/20 hover:bg-white/10 rounded text-[10px] text-[var(--foreground)] border border-[var(--aegis-glass-border)] transition-colors">
                                  <Play className="w-3 h-3 text-green-400" /> Replay
                                </button>
                                <button onClick={(e) => handleCopyCurl(frame, e)} className="flex items-center gap-1 px-2 py-1 bg-black/20 hover:bg-white/10 rounded text-[10px] text-[var(--foreground)] border border-[var(--aegis-glass-border)] transition-colors">
                                  <Copy className="w-3 h-3 text-blue-400" /> cURL
                                </button>
                                <button onClick={(e) => handleExportTrace(frame, e)} className="flex items-center gap-1 px-2 py-1 bg-black/20 hover:bg-white/10 rounded text-[10px] text-[var(--foreground)] border border-[var(--aegis-glass-border)] transition-colors">
                                  <Download className="w-3 h-3 text-amber-400" /> Export
                                </button>
                              </div>
                            </div>
                            <div className="bg-[#0d0d0d] rounded-lg border border-white/10 p-4 overflow-x-auto">
                              <JsonViewer data={frame} />
                            </div>
                          </div>
                        ) : (
                          <div className="text-xs text-[var(--aegis-text-muted)] p-3 mt-2 bg-black/10 rounded-lg border border-[var(--aegis-glass-border)] grid grid-cols-2 gap-2 animate-slide-in">
                            <div><strong className="text-[var(--foreground)] font-medium">Path:</strong> {frame.path}</div>
                            <div><strong className="text-[var(--foreground)] font-medium">Status:</strong> {frame.statusCode}</div>
                            <div><strong className="text-[var(--foreground)] font-medium">IP:</strong> {frame.clientIp}</div>
                            <div><strong className="text-[var(--foreground)] font-medium">Service:</strong> {frame.service}</div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            }}
          />
        )}
      </div>
    </div>
  );
}
