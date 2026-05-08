"use client";

import React, { useEffect, useState } from "react";
import { useSettings } from "./SettingsContext";
import { useTheme } from "next-themes";
import { Terminal, Settings, Trash2, Moon, Sun, Pause, Play, Clock, Activity, Network, Shield, Banknote } from "lucide-react";
import SettingsModal from "./SettingsModal";

const CORE_API_URL = process.env.NEXT_PUBLIC_CORE_API_URL || "http://localhost:4000";

export default function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const { theme, setTheme } = useTheme();
  const { isPaused, setIsPaused, timestampFormat, setTimestampFormat, setActiveApp } = useSettings();

  const handlePurge = async () => {
    try {
      await fetch(`${CORE_API_URL}/api/v1/strata/debugger/frames`, { method: "DELETE" });
    } catch (err) {
      console.error("Failed to purge buffer", err);
    }
  };

  const actions = [
    {
      id: "toggle-theme",
      name: `Toggle Dark Mode (${theme === "dark" ? "Light" : "Dark"})`,
      icon: theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />,
      perform: () => setTheme(theme === "dark" ? "light" : "dark"),
    },
    {
      id: "purge-buffer",
      name: "Purge Buffer",
      icon: <Trash2 className="w-4 h-4 text-red-400" />,
      perform: handlePurge,
    },
    {
      id: "toggle-pause",
      name: isPaused ? "Resume Polling" : "Pause Polling",
      icon: isPaused ? <Play className="w-4 h-4 text-green-400" /> : <Pause className="w-4 h-4 text-yellow-400" />,
      perform: () => setIsPaused((p) => !p),
    },
    {
      id: "toggle-timestamp",
      name: `Toggle Timestamp Format (Currently: ${timestampFormat})`,
      icon: <Clock className="w-4 h-4" />,
      perform: () => setTimestampFormat((f) => (f === "relative" ? "absolute" : "relative")),
    },
    {
      id: "settings",
      name: "Open Settings",
      icon: <Settings className="w-4 h-4" />,
      perform: () => setIsSettingsOpen(true),
    },
    {
      id: "switch-strata",
      name: "Switch to Strata Timeline",
      icon: <Activity className="w-4 h-4 text-[var(--accent)]" />,
      perform: () => setActiveApp("strata"),
    },
    {
      id: "switch-swarm",
      name: "Switch to SwarmChaos",
      icon: <Network className="w-4 h-4 text-[var(--accent)]" />,
      perform: () => setActiveApp("swarm-chaos"),
    },
    {
      id: "switch-vault",
      name: "Switch to VaultGuard",
      icon: <Shield className="w-4 h-4 text-[var(--accent)]" />,
      perform: () => setActiveApp("vault-guard"),
    },
    {
      id: "switch-token",
      name: "Switch to TokenBreaker",
      icon: <Banknote className="w-4 h-4 text-[var(--accent)]" />,
      perform: () => setActiveApp("token-breaker"),
    },
  ];

  const filteredActions = actions.filter((a) => a.name.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K or Ctrl+K
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen((o) => !o);
        setQuery("");
        setSelectedIndex(0);
        return;
      }

      // Do not trigger global shortcuts if focused on input/textarea
      const activeEl = document.activeElement;
      const isInput = activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA");

      if (!isOpen && !isInput) {
        if (e.key === " ") {
          e.preventDefault();
          setIsPaused((p) => !p);
        } else if (e.key.toLowerCase() === "c") {
          e.preventDefault();
          handlePurge();
        } else if (e.key.toLowerCase() === "t") {
          e.preventDefault();
          setTimestampFormat((f) => (f === "relative" ? "absolute" : "relative"));
        }
      }

      if (!isOpen) return;

      if (e.key === "Escape") {
        e.preventDefault();
        setIsOpen(false);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % filteredActions.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + filteredActions.length) % filteredActions.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const action = filteredActions[selectedIndex];
        if (action) {
          action.perform();
          setIsOpen(false);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, filteredActions, selectedIndex, setIsPaused, setTimestampFormat]);

  return (
    <>
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg glass-card rounded-xl overflow-hidden shadow-2xl border border-[var(--deploymantis-glass-border)] animate-slide-in">
            <div className="flex items-center px-4 py-3 border-b border-[var(--deploymantis-glass-border)] bg-black/20">
              <Terminal className="w-5 h-5 text-[var(--accent)] mr-3" />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelectedIndex(0);
                }}
                placeholder="Type a command or search..."
                className="w-full bg-transparent border-none outline-none text-[var(--foreground)] placeholder:text-[var(--deploymantis-text-muted)] text-sm font-mono"
              />
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-2">
              {filteredActions.length === 0 ? (
                <div className="px-4 py-3 text-sm text-[var(--deploymantis-text-muted)] text-center font-mono">
                  No commands found.
                </div>
              ) : (
                filteredActions.map((action, index) => (
                  <button
                    key={action.id}
                    onClick={() => {
                      action.perform();
                      setIsOpen(false);
                    }}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={`w-full flex items-center px-4 py-3 rounded-lg text-sm font-mono transition-colors ${
                      index === selectedIndex
                        ? "bg-[var(--accent)]/20 text-[var(--foreground)] border border-[var(--accent)] shadow-[0_0_10px_var(--deploymantis-accent-glow)]"
                        : "text-[var(--deploymantis-text-muted)] hover:bg-white/5 border border-transparent"
                    }`}
                  >
                    <span className="mr-3">{action.icon}</span>
                    {action.name}
                  </button>
                ))
              )}
            </div>
            <div className="px-4 py-2 border-t border-[var(--deploymantis-glass-border)] bg-black/20 text-[10px] text-[var(--deploymantis-text-muted)] flex justify-between font-mono">
              <span>Use <kbd className="bg-black/30 px-1 py-0.5 rounded border border-white/10">↑</kbd> <kbd className="bg-black/30 px-1 py-0.5 rounded border border-white/10">↓</kbd> to navigate</span>
              <span><kbd className="bg-black/30 px-1 py-0.5 rounded border border-white/10">Enter</kbd> to select</span>
              <span><kbd className="bg-black/30 px-1 py-0.5 rounded border border-white/10">Esc</kbd> to close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
