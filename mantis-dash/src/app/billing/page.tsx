"use client";

import React, { useState, useEffect } from "react";
import { Shield, Sparkles, CreditCard, Users, Check, RefreshCw, Key } from "lucide-react";

const CORE_API_URL = process.env.NEXT_PUBLIC_CORE_API_URL || "http://localhost:4000";

interface BillingStatus {
  plan: string;
  status: string;
  seats_purchased: number;
  current_period_end: string | null;
}

export default function BillingPage() {
  const [apiKey, setApiKey] = useState("");
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seats, setSeats] = useState(3); // default team seats
  const [planToCheckout, setPlanToCheckout] = useState<string | null>(null);

  // Load API key from localStorage on mount
  useEffect(() => {
    const savedKey = localStorage.getItem("mantis_api_key") || "";
    setApiKey(savedKey);
    if (savedKey) {
      fetchBillingStatus(savedKey);
    }
  }, []);

  const fetchBillingStatus = async (key: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${CORE_API_URL}/api/v1/billing/status`, {
        headers: {
          Authorization: `Bearer ${key}`,
        },
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new Error("Invalid API key. Please check and try again.");
        }
        throw new Error(`Failed to fetch status: ${res.statusText}`);
      }

      const data = await res.json();
      setBilling(data);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred");
      setBilling(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveKey = () => {
    localStorage.setItem("mantis_api_key", apiKey.trim());
    if (apiKey.trim()) {
      fetchBillingStatus(apiKey.trim());
    } else {
      setBilling(null);
      setError("Please enter a valid API key.");
    }
  };

  const handleCheckout = async (plan: string) => {
    if (!apiKey.trim()) {
      setError("You must enter and save your API Key before upgrading.");
      return;
    }

    setPlanToCheckout(plan);
    setError(null);

    try {
      const res = await fetch(`${CORE_API_URL}/api/v1/billing/checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({
          plan: plan,
          seats: plan === "team" ? seats : 1,
        }),
      });

      if (!res.ok) {
        const detail = await res.json();
        throw new Error(detail.detail || "Failed to create checkout session");
      }

      const { checkout_url } = await res.json();
      if (checkout_url) {
        window.location.href = checkout_url;
      } else {
        throw new Error("No redirect URL returned from checkout server.");
      }
    } catch (err: any) {
      setError(err.message || "Checkout redirection failed.");
      setPlanToCheckout(null);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "N/A";
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch (e) {
      return dateStr;
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto no-scrollbar font-sans p-6 text-[var(--foreground)]">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-3">
          <CreditCard className="w-8 h-8 text-[var(--accent)]" />
          Subscription & Billing
        </h1>
        <p className="text-sm text-[var(--mantis-text-muted)] mt-1.5">
          Manage your DeployMantis license tiers, active seats, and Stripe billing integrations.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: API Key Setup & Current Status */}
        <div className="lg:col-span-1 space-y-6">
          {/* API Key Setup */}
          <div className="glass-card rounded-2xl p-6 space-y-4">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <Key className="w-5 h-5 text-[var(--accent)]" />
              API Authentication
            </h3>
            <p className="text-xs text-[var(--mantis-text-muted)]">
              Paste your organization's API Key to verify your billing identity and refresh status.
            </p>
            <div className="space-y-2">
              <input
                type="password"
                placeholder="mantis_live_..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="w-full bg-black/45 border border-[var(--mantis-glass-border)] rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:border-[var(--accent)] transition-colors"
              />
              <button
                onClick={handleSaveKey}
                className="w-full bg-[var(--accent)] hover:bg-[var(--accent)]/80 text-black font-semibold text-sm py-2.5 rounded-xl transition-colors cursor-pointer"
              >
                Authenticate & Verify
              </button>
            </div>
          </div>

          {/* Current Status Box */}
          <div className="glass-card rounded-2xl p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold">Billing Status</h3>
              {loading && <RefreshCw className="w-4 h-4 animate-spin text-[var(--accent)]" />}
            </div>

            {error && (
              <div className="bg-red-950/40 border border-red-900/60 rounded-xl p-3 text-xs text-red-300">
                {error}
              </div>
            )}

            {billing ? (
              <div className="space-y-3">
                <div className="flex justify-between py-2 border-b border-white/[0.04] text-sm">
                  <span className="text-[var(--mantis-text-muted)]">Active Tier</span>
                  <span className="font-semibold uppercase text-[var(--accent)] tracking-wider">
                    {billing.plan}
                  </span>
                </div>
                <div className="flex justify-between py-2 border-b border-white/[0.04] text-sm">
                  <span className="text-[var(--mantis-text-muted)]">Status</span>
                  <span className="font-semibold capitalize text-emerald-400">
                    {billing.status}
                  </span>
                </div>
                <div className="flex justify-between py-2 border-b border-white/[0.04] text-sm">
                  <span className="text-[var(--mantis-text-muted)]">Purchased Seats</span>
                  <span className="font-semibold font-mono">{billing.seats_purchased}</span>
                </div>
                <div className="flex justify-between py-2 text-sm">
                  <span className="text-[var(--mantis-text-muted)]">Renewal Date</span>
                  <span className="font-medium text-gray-300">
                    {formatDate(billing.current_period_end)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-center py-6 border border-dashed border-white/[0.05] rounded-xl text-xs text-[var(--mantis-text-muted)]">
                Not authenticated. Enter API key above to view billing details.
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Plans Catalog */}
        <div className="lg:col-span-2 space-y-6">
          <h2 className="text-xl font-bold">Select Deployment Tier</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Developer Tier Card */}
            <div className="glass-card rounded-2xl p-6 flex flex-col justify-between relative overflow-hidden border border-white/[0.04] hover:border-[var(--accent)]/30 transition-all duration-300">
              <div className="space-y-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-xl font-extrabold">Developer Plan</h3>
                    <p className="text-xs text-[var(--mantis-text-muted)] mt-1">Single-engineer validation mesh</p>
                  </div>
                  <Sparkles className="w-5 h-5 text-[var(--accent)]" />
                </div>

                <div className="flex items-baseline gap-1 mt-2">
                  <span className="text-3xl font-mono font-extrabold">$19</span>
                  <span className="text-sm text-[var(--mantis-text-muted)]">/ month</span>
                </div>

                <ul className="space-y-2.5 text-xs text-gray-300 pt-2">
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    MantisSnap state capture
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    MantisLaunch topology sandbox
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    MantisVerify AST compliance gate
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    MantisStyle code layout profiler
                  </li>
                  <li className="flex items-center gap-2 text-[var(--mantis-text-muted)]">
                    <Users className="w-3.5 h-3.5 shrink-0" />
                    Limited to 1 Seat
                  </li>
                </ul>
              </div>

              <div className="pt-6">
                <button
                  onClick={() => handleCheckout("developer")}
                  disabled={planToCheckout !== null || billing?.plan === "developer"}
                  className={`w-full py-2.5 rounded-xl font-semibold text-sm transition-colors cursor-pointer text-center ${
                    billing?.plan === "developer"
                      ? "bg-white/[0.05] text-[var(--mantis-text-muted)] border border-white/[0.05] cursor-not-allowed"
                      : "bg-white text-black hover:bg-white/90"
                  }`}
                >
                  {planToCheckout === "developer" ? (
                    <RefreshCw className="w-4 h-4 animate-spin mx-auto" />
                  ) : billing?.plan === "developer" ? (
                    "Active Plan"
                  ) : (
                    "Upgrade to Developer"
                  )}
                </button>
              </div>
            </div>

            {/* Team Tier Card */}
            <div className="glass-card rounded-2xl p-6 flex flex-col justify-between relative overflow-hidden border border-[var(--accent)]/30 glow-accent shadow-2xl transition-all duration-300">
              <div className="space-y-4">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="bg-[var(--accent)]/20 text-[var(--accent)] text-[9px] uppercase tracking-wider font-extrabold px-2 py-0.5 rounded-full">
                      Recommended
                    </span>
                    <h3 className="text-xl font-extrabold mt-1.5">Team Plan</h3>
                    <p className="text-xs text-[var(--mantis-text-muted)] mt-1">Multi-agent governance & Chaos testing</p>
                  </div>
                  <Shield className="w-5 h-5 text-[var(--accent)]" />
                </div>

                <div className="flex items-baseline gap-1 mt-2">
                  <span className="text-3xl font-mono font-extrabold">$39</span>
                  <span className="text-xs text-[var(--mantis-text-muted)]">/ seat / month</span>
                </div>

                {/* Team Seat Count Selector */}
                <div className="bg-black/25 rounded-xl p-3 border border-white/[0.04] space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-[var(--mantis-text-muted)]">Seat Quantity:</span>
                    <span className="font-bold text-[var(--accent)]">{seats} seats</span>
                  </div>
                  <input
                    type="range"
                    min="2"
                    max="50"
                    value={seats}
                    onChange={(e) => setSeats(Number(e.target.value))}
                    className="w-full h-1 bg-black/45 rounded-lg appearance-none cursor-pointer accent-[var(--accent)]"
                  />
                  <div className="flex justify-between text-[9px] text-[var(--mantis-text-muted)]">
                    <span>2 Seats min</span>
                    <span>50 Seats max</span>
                  </div>
                </div>

                <ul className="space-y-2.5 text-xs text-gray-300 pt-1">
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <strong>All scopes</strong> unlocked universally
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    Auditing & governance logs
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    Custom model configurations
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    SwarmChaos agent saboteurs
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    Scaling capacity as needed
                  </li>
                </ul>
              </div>

              <div className="pt-6">
                <button
                  onClick={() => handleCheckout("team")}
                  disabled={planToCheckout !== null || billing?.plan === "team"}
                  className={`w-full py-2.5 rounded-xl font-semibold text-sm transition-colors cursor-pointer text-center ${
                    billing?.plan === "team"
                      ? "bg-white/[0.05] text-[var(--mantis-text-muted)] border border-white/[0.05] cursor-not-allowed"
                      : "bg-[var(--accent)] text-black hover:bg-[var(--accent)]/90"
                  }`}
                >
                  {planToCheckout === "team" ? (
                    <RefreshCw className="w-4 h-4 animate-spin mx-auto text-black" />
                  ) : billing?.plan === "team" ? (
                    "Active Plan"
                  ) : (
                    "Activate Team Plan"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
