"use client";
import { useState, useEffect } from "react";
import { METHODOLOGY } from "@/lib/methodology";
import type { MethodologyKey } from "@/lib/methodology";

interface Props {
  /** Must match one of the METHODOLOGY keys. Unknown keys render nothing. */
  id: string;
}

export function MethodologyBox({ id }: Props) {
  const [open, setOpen] = useState(false);

  // Close the panel whenever the user switches to a different tab.
  useEffect(() => { setOpen(false); }, [id]);

  const entry = METHODOLOGY[id as MethodologyKey];
  if (!entry) return null;

  return (
    <div className="mt-6 border border-blue-200 rounded-lg overflow-hidden print-hide">
      {/* Toggle button */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-blue-800 bg-blue-50 hover:bg-blue-100 transition-colors"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <span className="text-base leading-none">ℹ</span>
          <span>About this analysis</span>
        </span>
        <span className="text-xs text-blue-500 font-normal">
          {open ? "▲ hide" : "▼ show"}
        </span>
      </button>

      {/* Expandable content */}
      {open && (
        <div className="border-t border-blue-200 bg-white px-5 py-4 space-y-3">
          <h3 className="font-semibold text-gray-900 text-sm">{entry.title}</h3>

          {entry.paragraphs.map((para, i) => (
            <p key={i} className="text-sm text-gray-700 leading-relaxed">
              {para}
            </p>
          ))}

          {entry.references && entry.references.length > 0 && (
            <div className="pt-1">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                References
              </p>
              <ul className="space-y-1">
                {entry.references.map((ref, i) => (
                  <li key={i} className="text-xs text-gray-500 leading-snug">
                    {ref.url ? (
                      <a
                        href={ref.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        {ref.text}
                      </a>
                    ) : (
                      ref.text
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
