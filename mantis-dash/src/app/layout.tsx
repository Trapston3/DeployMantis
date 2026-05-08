import type { Metadata } from "next";
import "./globals.css";
import React from "react";
import Sidebar from "@/components/Sidebar";
import CommandPalette from "@/components/CommandPalette";
import { ThemeProvider } from "next-themes";
import { SettingsProvider } from "@/components/SettingsContext";

export const metadata: Metadata = {
  title: "DeployMantis — Command Center",
  description: "Enterprise AI-native SRE dashboard for multi-agent reliability testing.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex h-screen overflow-hidden antialiased selection:bg-[var(--accent)] selection:text-white">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <SettingsProvider>
            <CommandPalette />
            {/* Left Sidebar (20%) */}
            <Sidebar />

            {/* Main Workspace (80%) */}
            <main className="flex-1 p-5 flex flex-col h-full overflow-hidden">
              {children}
            </main>
          </SettingsProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
