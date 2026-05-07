"use client";

import React from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useTheme } from "next-themes";
import { useSettings } from "./SettingsContext";
import { X, Moon, Sun, Info } from "lucide-react";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { theme, setTheme } = useTheme();
  const {
    autoPurge,
    setAutoPurge,
    pollingInterval,
    setPollingInterval,
    dataVerbosity,
    setDataVerbosity,
  } = useSettings();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-slide-in">
      <div className="glass-card w-full max-w-md p-6 rounded-2xl shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-white/10 transition-colors text-[var(--aegis-text-muted)] hover:text-[var(--foreground)]"
        >
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-xl font-bold text-[var(--foreground)] mb-6 flex items-center gap-2">
          Dashboard Settings
        </h2>

        <div className="space-y-6">
          {/* Theme Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-[var(--foreground)]">Theme</div>
              <div className="text-xs text-[var(--aegis-text-muted)]">Toggle light/dark aesthetic</div>
            </div>
            <div className="flex bg-black/20 p-1 rounded-lg border border-[var(--aegis-glass-border)]">
              <button
                onClick={() => setTheme("light")}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  theme === "light" ? "bg-white text-black shadow-sm" : "text-gray-400 hover:text-white"
                }`}
              >
                <Sun className="w-4 h-4" />
                Light
              </button>
              <button
                onClick={() => setTheme("dark")}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  theme === "dark" ? "bg-[#333] text-white shadow-sm" : "text-gray-400 hover:text-white"
                }`}
              >
                <Moon className="w-4 h-4" />
                Dark
              </button>
            </div>
          </div>

          {/* Auto Purge */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <div>
                <div className="text-sm font-semibold text-[var(--foreground)]">Auto-Purge (Test Run)</div>
                <div className="text-xs text-[var(--aegis-text-muted)]">Automatically clear full buffers</div>
              </div>
              <Tooltip.Provider>
                <Tooltip.Root delayDuration={200}>
                  <Tooltip.Trigger asChild>
                    <button className="text-[var(--aegis-text-muted)] hover:text-[var(--accent)] transition-colors">
                      <Info className="w-4 h-4" />
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      className="glass-card z-50 text-xs text-[var(--foreground)] p-2.5 rounded max-w-xs shadow-lg"
                      sideOffset={5}
                    >
                      Wipes the entire timeline when the buffer reaches maximum capacity (50). Best used for automated, isolated stress tests.
                      <Tooltip.Arrow className="fill-[var(--aegis-glass-border)]" />
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
              </Tooltip.Provider>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={autoPurge}
                onChange={(e) => setAutoPurge(e.target.checked)}
              />
              <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--accent)]"></div>
            </label>
          </div>

          {/* Polling Interval */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-[var(--foreground)]">Polling Interval</div>
                <div className="text-xs text-[var(--aegis-text-muted)]">Fetch rate for new logs</div>
              </div>
              <div className="text-xs font-mono text-[var(--accent)]">{pollingInterval}ms</div>
            </div>
            <input
              type="range"
              min="500"
              max="5000"
              step="500"
              value={pollingInterval}
              onChange={(e) => setPollingInterval(Number(e.target.value))}
              className="w-full h-1.5 bg-black/30 rounded-lg appearance-none cursor-pointer accent-[var(--accent)]"
            />
            <div className="flex justify-between text-[10px] text-[var(--aegis-text-muted)] px-1">
              <span>500ms</span>
              <span>5000ms</span>
            </div>
          </div>

          {/* Data Verbosity */}
          <div className="space-y-3">
            <div>
              <div className="text-sm font-semibold text-[var(--foreground)]">Data Verbosity</div>
              <div className="text-xs text-[var(--aegis-text-muted)]">Timeline log details level</div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setDataVerbosity("Compact")}
                className={`flex-1 py-2 rounded-lg border text-xs font-medium transition-all ${
                  dataVerbosity === "Compact"
                    ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                    : "border-[var(--aegis-glass-border)] bg-black/10 text-[var(--aegis-text-muted)] hover:text-[var(--foreground)]"
                }`}
              >
                Compact
              </button>
              <button
                onClick={() => setDataVerbosity("Developer Mode")}
                className={`flex-1 py-2 rounded-lg border text-xs font-medium transition-all ${
                  dataVerbosity === "Developer Mode"
                    ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                    : "border-[var(--aegis-glass-border)] bg-black/10 text-[var(--aegis-text-muted)] hover:text-[var(--foreground)]"
                }`}
              >
                Developer Mode
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
