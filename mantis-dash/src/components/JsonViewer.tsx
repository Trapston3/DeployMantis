"use client";

import React, { useState } from "react";
import { ChevronRight, ChevronDown, Copy, Check } from "lucide-react";

interface JsonViewerProps {
  data: any;
  path?: string;
  isRoot?: boolean;
}

export default function JsonViewer({ data, path = "", isRoot = true }: JsonViewerProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const handleCopyPath = (e: React.MouseEvent, copyPath: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(copyPath);
    setCopiedPath(copyPath);
    setTimeout(() => setCopiedPath(null), 1500);
  };

  const renderValue = (value: any, currentPath: string) => {
    if (value === null) {
      return <span className="text-[#a1a1aa]">null</span>;
    }
    if (typeof value === "boolean") {
      return <span className="text-[#3b82f6]">{value ? "true" : "false"}</span>;
    }
    if (typeof value === "number") {
      return <span className="text-[#f59e0b]">{value}</span>;
    }
    if (typeof value === "string") {
      return <span className="text-[#d4d4d8]">"{value}"</span>;
    }
    if (typeof value === "object") {
      return <JsonViewer data={value} path={currentPath} isRoot={false} />;
    }
    return <span>{String(value)}</span>;
  };

  if (typeof data !== "object" || data === null) {
    return renderValue(data, path);
  }

  const isArray = Array.isArray(data);
  const keys = Object.keys(data);
  const isEmpty = keys.length === 0;

  if (isEmpty) {
    return <span className="text-[#a1a1aa]">{isArray ? "[]" : "{}"}</span>;
  }

  return (
    <div className={`font-mono text-[11px] leading-relaxed ${isRoot ? "text-[#e5e5e5]" : ""}`}>
      <span
        className="cursor-pointer hover:text-[var(--accent)] select-none inline-flex items-center"
        onClick={(e) => {
          e.stopPropagation();
          setIsExpanded(!isExpanded);
        }}
      >
        {!isRoot && (
          <span className="opacity-50 hover:opacity-100 transition-opacity">
            {isExpanded ? <ChevronDown className="w-3 h-3 inline mr-1" /> : <ChevronRight className="w-3 h-3 inline mr-1" />}
          </span>
        )}
        <span className="text-[#a1a1aa]">{isArray ? "[" : "{"}</span>
        {!isExpanded && <span className="text-[#a1a1aa]"> ... {isArray ? "]" : "}"}</span>}
      </span>

      {isExpanded && (
        <div className={`${isRoot ? "" : "pl-4 border-l border-white/10 ml-1"} mt-1 mb-1`}>
          {keys.map((key, index) => {
            const newPath = path ? (isArray ? `${path}[${key}]` : `${path}.${key}`) : key;
            const value = data[key as keyof typeof data];
            const isLast = index === keys.length - 1;

            return (
              <div key={key} className="flex relative group whitespace-pre-wrap">
                <span className="flex-1">
                  {!isArray && (
                    <span className="text-[#8a9a86] group-hover:text-[#a3b89e] transition-colors">
                      "{key}"
                      <span className="text-[#a1a1aa] mr-1">:</span>
                    </span>
                  )}
                  {renderValue(value, newPath)}
                  {!isLast && <span className="text-[#a1a1aa]">,</span>}
                </span>

                {/* Hover Action: Copy Path */}
                <button
                  className="absolute right-0 top-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 bg-black/40 hover:bg-[var(--accent)]/40 rounded text-[var(--deploymantis-text-muted)] hover:text-[var(--foreground)]"
                  title="Copy path"
                  onClick={(e) => handleCopyPath(e, newPath)}
                >
                  {copiedPath === newPath ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {isExpanded && <span className="text-[#a1a1aa]">{isArray ? "]" : "}"}</span>}
    </div>
  );
}
