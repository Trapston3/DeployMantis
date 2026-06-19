"use client";

import { useSettings } from "@/components/SettingsContext";
import StrataApp from "@/components/apps/StrataApp";
import SwarmChaosApp from "@/components/apps/SwarmChaosApp";
import VaultGuardApp from "@/components/apps/VaultGuardApp";
import TokenBreakerApp from "@/components/apps/TokenBreakerApp";
import MantisSnapApp from "@/components/apps/MantisSnapApp";
import type { AppId } from "@/components/SettingsContext";

const APP_REGISTRY: Record<AppId, React.ComponentType> = {
  "strata":        StrataApp,
  "swarm-chaos":   SwarmChaosApp,
  "vault-guard":   VaultGuardApp,
  "token-breaker": TokenBreakerApp,
  "mantis-snap":   MantisSnapApp,
};

export default function Home() {
  const { activeApp } = useSettings();
  const ActiveComponent = APP_REGISTRY[activeApp] ?? StrataApp;

  return (
    <div className="flex flex-col h-full">
      <ActiveComponent />
    </div>
  );
}
