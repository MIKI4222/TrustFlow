"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { EXPLORER } from "@/lib/genlayer";

// Copies the COMPLETE value. "Copied" is shown only after the clipboard write actually succeeded;
// if the browser refuses (permissions, insecure context) the user sees "Copy failed" instead.
export function CopyButton({ value, label = "value" }: { value: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const onClick = async () => {
    try { await navigator.clipboard.writeText(value); setState("copied"); } catch { setState("failed"); }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1800);
  };
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 rounded border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-300 hover:bg-slate-800" aria-label={`Copy ${label}`}>
      {state === "copied" ? <Check size={11} aria-hidden /> : <Copy size={11} aria-hidden />}
      <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}</span>
    </button>
  );
}

// Shortened address / hash for layout, full value in the tooltip and always in the clipboard.
export function AddressChip({ value, kind = "address" }: { value: string; kind?: "address" | "tx" }) {
  if (!value) return <span className="text-slate-500">—</span>;
  const short = value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 align-middle">
      <code className="break-all text-xs" title={value}>{short}</code>
      <CopyButton value={value} label={kind === "tx" ? "transaction hash" : "address"} />
      <a href={`${EXPLORER}/${kind}/${value}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-indigo-300 hover:underline" aria-label={`View ${kind === "tx" ? "transaction" : "address"} in explorer (opens in a new tab)`}>
        Explorer <ExternalLink size={11} aria-hidden />
      </a>
    </span>
  );
}
