import type { ReactNode } from "react";
import type { FfaWarning } from "@/lib/types";

type Level = FfaWarning["level"];

const styles: Record<Level, string> = {
  info: "bg-blue-50 border-blue-300 text-blue-900",
  caution: "bg-amber-50 border-amber-300 text-amber-900",
  warning: "bg-orange-50 border-orange-400 text-orange-900",
  error: "bg-red-50 border-red-400 text-red-900",
};

const icons: Record<Level, string> = {
  info: "ℹ",
  caution: "⚠",
  warning: "⚠",
  error: "✕",
};

export function Callout({ level, children }: { level: Level; children: ReactNode }) {
  return (
    <div className={`border-l-4 px-4 py-3 rounded-r text-sm ${styles[level]}`} role="alert">
      <span className="font-bold mr-2">{icons[level]}</span>
      {children}
    </div>
  );
}
