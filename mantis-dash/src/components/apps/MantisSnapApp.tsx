"use client";

import React, { useState } from "react";
import {
  Camera,
  Download,
  GitBranch,
  GitCommit,
  FileCode2,
  AlertTriangle,
  CheckCircle2,
  WifiOff,
  Loader2,
  ListTodo,
  StickyNote,
  Clock,
  Radio,
} from "lucide-react";

// ── Constants ─────────────────────────────────────────────────
const CORE_API_URL =
  process.env.NEXT_PUBLIC_CORE_API_URL || "http://localhost:4000";

// ── Types ──────────────────────────────────────────────────────
type GitSummary = {
  commit: string | null;
  author: string | null;
  message: string | null;
  dirty_files: string[];
};

type StrataHighlight = {
  timestamp: string | null;
  level: string;
  message: string;
};

type Snapshot = {
  branch: string;
  last_captured: string;
  git_summary: GitSummary;
  strata_highlights: StrataHighlight[];
  note: string;
  todo_hints: string[];
};

type ToastState = { msg: string; type: "ok" | "err" } | null;
type LoadState = "idle" | "capturing" | "loading" | "loaded" | "error";

// ── Sub-components ─────────────────────────────────────────────

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
        <CheckCircle2 className="w-4 h-4 shrink-0" />
      ) : (
        <WifiOff className="w-4 h-4 shrink-0" />
      )}
      <span>{toast.msg}</span>
    </div>
  );
}

/** Single-line labelled field */
function InfoRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-widest text-[var(--mantis-text-muted)]">
        {label}
      </span>
      <span
        className={`text-sm text-[var(--foreground)] break-all ${mono ? "font-mono" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

/** Level badge for Strata frames */
function LevelBadge({ level }: { level: string }) {
  const colours: Record<string, string> = {
    error: "text-red-400 bg-red-400/10 border-red-400/20",
    warn: "text-amber-400 bg-amber-400/10 border-amber-400/20",
    info: "text-sky-400 bg-sky-400/10 border-sky-400/20",
  };
  const cls = colours[level] ?? "text-gray-400 bg-gray-400/10 border-gray-400/20";
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ${cls}`}
    >
      {level}
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────
export default function MantisSnapApp() {
  const [branch, setBranch] = useState("main");
  const [note, setNote] = useState("");
  const [state, setState] = useState<LoadState>("idle");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);

  // ── Toast helper ─────────────────────────────────────────────
  function showToast(msg: string, type: "ok" | "err") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }

  // ── Capture ──────────────────────────────────────────────────
  async function handleCapture() {
    const trimmedBranch = branch.trim() || "main";
    setState("capturing");
    setErrorMsg(null);

    try {
      const res = await fetch(`${CORE_API_URL}/api/v1/mantis-snap/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note.trim() || undefined, branch: trimmedBranch }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.detail ?? `HTTP ${res.status}`);
      }

      const data = await res.json();
      const capturedAt = new Date(data.captured_at).toLocaleTimeString();
      showToast(`Snapshot saved for branch: ${data.branch} at ${capturedAt}`, "ok");
      setState("idle");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Capture failed";
      console.error("[MantisSnap] capture error:", e);
      setErrorMsg(msg);
      showToast("Capture failed — check console", "err");
      setState("error");
    }
  }

  // ── Load ─────────────────────────────────────────────────────
  async function handleLoad() {
    const trimmedBranch = branch.trim() || "main";
    setState("loading");
    setSnapshot(null);
    setErrorMsg(null);

    try {
      const res = await fetch(
        `${CORE_API_URL}/api/v1/mantis-snap/${encodeURIComponent(trimmedBranch)}`
      );

      if (res.status === 404) {
        setErrorMsg(`No snapshot found for branch "${trimmedBranch}" yet.`);
        setState("error");
        return;
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.detail ?? `HTTP ${res.status}`);
      }

      const data: Snapshot = await res.json();
      setSnapshot(data);
      setState("loaded");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Load failed";
      console.error("[MantisSnap] load error:", e);
      setErrorMsg(msg);
      showToast("Load failed — check console", "err");
      setState("error");
    }
  }

  // ── Derived ───────────────────────────────────────────────────
  const isCapturing = state === "capturing";
  const isLoading = state === "loading";
  const isBusy = isCapturing || isLoading;

  const topStrataFrames = snapshot?.strata_highlights.slice(-5).reverse() ?? [];

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full gap-5 overflow-y-auto no-scrollbar pb-10">
      <Toast toast={toast} />

      {/* ── Header ─────────────────────────────────────────── */}
      <header className="px-2 flex items-start justify-between shrink-0">
        <div>
          <h2 className="text-[var(--foreground)] text-xl font-bold tracking-wide flex items-center gap-2">
            <Camera className="w-6 h-6 text-[var(--accent)]" />
            MantisSnap — Context Time Machine
          </h2>
          <p className="text-[var(--mantis-text-muted)] text-sm mt-1.5 font-mono">
            Save and restore "what I was doing" on any branch in one click.
          </p>
        </div>
      </header>

      {/* ── Controls panel ─────────────────────────────────── */}
      <div className="glass rounded-xl p-5 flex flex-col gap-4 shrink-0">
        {/* Branch + Note row */}
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Branch field */}
          <div className="flex flex-col gap-1.5 flex-1 min-w-0">
            <label
              htmlFor="snap-branch"
              className="text-[10px] uppercase tracking-widest text-[var(--mantis-text-muted)] flex items-center gap-1.5"
            >
              <GitBranch className="w-3 h-3" />
              Branch
            </label>
            <input
              id="snap-branch"
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main"
              disabled={isBusy}
              className="bg-black/20 border border-[var(--mantis-glass-border)] rounded-lg px-3 py-2 text-sm font-mono text-[var(--foreground)] placeholder:text-[var(--mantis-text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors disabled:opacity-50"
            />
          </div>

          {/* Note field */}
          <div className="flex flex-col gap-1.5 flex-[2] min-w-0">
            <label
              htmlFor="snap-note"
              className="text-[10px] uppercase tracking-widest text-[var(--mantis-text-muted)] flex items-center gap-1.5"
            >
              <StickyNote className="w-3 h-3" />
              Note (optional)
            </label>
            <input
              id="snap-note"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. debugging auth flow..."
              disabled={isBusy}
              className="bg-black/20 border border-[var(--mantis-glass-border)] rounded-lg px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--mantis-text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors disabled:opacity-50"
            />
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3">
          <button
            id="snap-capture-btn"
            onClick={handleCapture}
            disabled={isBusy}
            className="flex items-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent)]/80 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          >
            {isCapturing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Camera className="w-4 h-4" />
            )}
            {isCapturing ? "Capturing…" : "Capture Snapshot"}
          </button>

          <button
            id="snap-load-btn"
            onClick={handleLoad}
            disabled={isBusy}
            className="flex items-center gap-2 glass-subtle hover:bg-white/[0.06] border border-[var(--mantis-glass-border)] disabled:opacity-50 text-[var(--foreground)] rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            {isLoading ? "Loading…" : "Load Snapshot"}
          </button>
        </div>

        {/* Error banner */}
        {state === "error" && errorMsg && (
          <div className="flex items-start gap-2 bg-red-900/20 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-300 animate-slide-in">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}
      </div>

      {/* ── Snapshot result ─────────────────────────────────── */}
      {state === "loaded" && snapshot && (
        <div className="flex flex-col gap-4 animate-slide-in">

          {/* Meta bar */}
          <div className="flex flex-wrap gap-4 px-1">
            <div className="flex items-center gap-1.5 text-xs text-[var(--mantis-text-muted)]">
              <GitBranch className="w-3.5 h-3.5 text-[var(--accent)]" />
              <span className="font-mono text-[var(--foreground)] font-semibold">
                {snapshot.branch}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-[var(--mantis-text-muted)]">
              <Clock className="w-3.5 h-3.5" />
              {new Date(snapshot.last_captured).toLocaleString()}
            </div>
            {snapshot.note && (
              <div className="flex items-center gap-1.5 text-xs text-[var(--mantis-text-muted)]">
                <StickyNote className="w-3.5 h-3.5" />
                <span className="italic">{snapshot.note}</span>
              </div>
            )}
          </div>

          <div className="flex flex-col lg:flex-row gap-4">
            {/* ── Left column: Git Summary ─────────────────── */}
            <div className="glass-card rounded-xl p-5 flex flex-col gap-4 lg:w-1/2">
              <h3 className="text-sm font-semibold text-[var(--foreground)] flex items-center gap-2">
                <GitCommit className="w-4 h-4 text-[var(--accent)]" />
                Git Summary
              </h3>

              <div className="flex flex-col gap-3">
                <InfoRow
                  label="Commit"
                  value={snapshot.git_summary.commit}
                  mono
                />
                <InfoRow label="Author" value={snapshot.git_summary.author} />
                <InfoRow
                  label="Message"
                  value={snapshot.git_summary.message}
                />
              </div>

              {/* Dirty files */}
              {snapshot.git_summary.dirty_files.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="text-[10px] uppercase tracking-widest text-[var(--mantis-text-muted)] flex items-center gap-1.5">
                    <FileCode2 className="w-3 h-3" />
                    Uncommitted ({snapshot.git_summary.dirty_files.length})
                  </span>
                  <ul className="space-y-1">
                    {snapshot.git_summary.dirty_files.map((f) => (
                      <li
                        key={f}
                        className="font-mono text-[11px] text-amber-400 bg-amber-400/5 border border-amber-400/10 rounded px-2 py-1 break-all"
                      >
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {!snapshot.git_summary.commit && (
                <p className="text-xs text-[var(--mantis-text-muted)] italic">
                  Git info unavailable (not a git repo or git not found).
                </p>
              )}
            </div>

            {/* ── Right column: Strata + TODOs ─────────────── */}
            <div className="flex flex-col gap-4 lg:w-1/2">
              {/* Strata highlights */}
              <div className="glass-card rounded-xl p-5 flex flex-col gap-3">
                <h3 className="text-sm font-semibold text-[var(--foreground)] flex items-center gap-2">
                  <Radio className="w-4 h-4 text-[var(--accent)]" />
                  Strata Highlights
                  <span className="text-[10px] text-[var(--mantis-text-muted)] font-normal ml-auto">
                    last 5 frames
                  </span>
                </h3>

                {topStrataFrames.length === 0 ? (
                  <p className="text-xs text-[var(--mantis-text-muted)] italic">
                    No Strata frames captured (Strata may be offline).
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {topStrataFrames.map((frame, i) => (
                      <li
                        key={i}
                        className="flex flex-col gap-1 border-b border-[var(--mantis-glass-border)] last:border-0 pb-2 last:pb-0"
                      >
                        <div className="flex items-center gap-2">
                          <LevelBadge level={frame.level} />
                          {frame.timestamp && (
                            <span className="text-[10px] font-mono text-[var(--mantis-text-muted)]">
                              {new Date(frame.timestamp).toLocaleTimeString()}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[var(--foreground)] font-mono break-all leading-relaxed">
                          {frame.message}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Todo hints */}
              <div className="glass-card rounded-xl p-5 flex flex-col gap-3">
                <h3 className="text-sm font-semibold text-[var(--foreground)] flex items-center gap-2">
                  <ListTodo className="w-4 h-4 text-[var(--accent)]" />
                  Suggested Next Steps
                </h3>

                {snapshot.todo_hints.length === 0 ? (
                  <p className="text-xs text-[var(--mantis-text-muted)] italic">
                    No hints generated — workspace looks clean!
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {snapshot.todo_hints.map((hint, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="mt-1 w-4 h-4 flex items-center justify-center rounded-full bg-[var(--accent)]/15 text-[var(--accent)] text-[9px] font-bold shrink-0">
                          {i + 1}
                        </span>
                        <span className="text-xs text-[var(--foreground)] leading-relaxed">
                          {hint}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Empty state ─────────────────────────────────────── */}
      {state === "idle" && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center opacity-60">
          <Camera className="w-10 h-10 text-[var(--accent)]" />
          <p className="text-sm text-[var(--mantis-text-muted)]">
            Enter a branch name and hit{" "}
            <span className="font-semibold text-[var(--foreground)]">
              Capture Snapshot
            </span>{" "}
            to save your context,
            <br />
            or{" "}
            <span className="font-semibold text-[var(--foreground)]">
              Load Snapshot
            </span>{" "}
            to recall a previous session.
          </p>
        </div>
      )}
    </div>
  );
}
