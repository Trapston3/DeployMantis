"use client";
import React, { createContext, useContext, useState, ReactNode } from "react";

type DataVerbosity = "Compact" | "Developer Mode";
type TimestampFormat = "relative" | "absolute";
export type AppId = "strata" | "swarm-chaos" | "vault-guard" | "token-breaker";

interface SettingsContextType {
  activeApp: AppId;
  setActiveApp: (val: AppId) => void;
  autoPurge: boolean;
  setAutoPurge: (val: boolean) => void;
  pollingInterval: number;
  setPollingInterval: (val: number) => void;
  dataVerbosity: DataVerbosity;
  setDataVerbosity: (val: DataVerbosity) => void;
  isPaused: boolean;
  setIsPaused: (val: boolean | ((prev: boolean) => boolean)) => void;
  timestampFormat: TimestampFormat;
  setTimestampFormat: (val: TimestampFormat | ((prev: TimestampFormat) => TimestampFormat)) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [activeApp, setActiveApp] = useState<AppId>("strata");
  const [autoPurge, setAutoPurge] = useState(false);
  const [pollingInterval, setPollingInterval] = useState(2000);
  const [dataVerbosity, setDataVerbosity] = useState<DataVerbosity>("Compact");
  const [isPaused, setIsPaused] = useState(false);
  const [timestampFormat, setTimestampFormat] = useState<TimestampFormat>("absolute");

  return (
    <SettingsContext.Provider
      value={{
        activeApp,
        setActiveApp,
        autoPurge,
        setAutoPurge,
        pollingInterval,
        setPollingInterval,
        dataVerbosity,
        setDataVerbosity,
        isPaused,
        setIsPaused,
        timestampFormat,
        setTimestampFormat,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
}
