import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import type { Stage } from "@/lib/genlayer";
const steps: [Stage, string][] = [["broadcast", "Broadcasting Transaction"], ["consensus", "Waiting for Consensus"], ["reasoning", "Executing AI Reasoning"], ["success", "Success"]];
export default function TxStatus({ stage, detail }: { stage: Stage; detail?: string }) {
  if (stage === "idle") return null;
  const idx = steps.findIndex(([s]) => s === stage);
  return (
    <ol className="mt-3 space-y-1 text-sm">
      {steps.map(([s, label], i) => {
        const done = stage === "success" || idx > i;
        const active = idx === i && stage !== "success";
        return <li key={s} className={`flex items-center gap-2 ${done || active ? "text-slate-100" : "text-slate-600"}`}>
          {done ? <CheckCircle2 size={14} className="text-emerald-400" /> : active ? <Loader2 size={14} className="animate-spin text-indigo-400" /> : <span className="w-3.5" />}{label}</li>;
      })}
      {stage === "reverted" && <li className="flex items-center gap-2 text-red-400"><XCircle size={14} />Reverted</li>}
      {detail && <li className="text-xs text-slate-500">network status: {detail}</li>}
    </ol>
  );
}
