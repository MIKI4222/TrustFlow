"use client";
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { EXPLORER, SLA, ESC, AuditEntry, read } from "@/lib/genlayer";
import { getClaims, getDeals, winnerOf, Deal } from "@/lib/api";
export default function Audit() {
  const [log, setLog] = useState<AuditEntry[]>([]);
  const [claims, setClaims] = useState<any[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [errs, setErrs] = useState<string[]>([]);
  useEffect(() => {
    setLog(JSON.parse(localStorage.getItem("tf_audit") || "[]"));
    const add = (m: string) => setErrs((p) => [...p, m]);
    getClaims(read, SLA, 100).then(setClaims).catch((e) => add(`get_claims_history: ${e.message}`));
    getDeals(read, ESC).then(setDeals).catch((e) => add(`get_all_deals: ${e.message}`));
  }, []);
  const raw = (x: any) => <details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer">raw</summary><pre className="max-h-72 overflow-auto">{JSON.stringify(x, null, 2)}</pre></details>;
  return <>
    <h1 className="text-2xl font-bold">Explorer & Audit Logs</h1>
    <div className="flex gap-3 text-sm">
      <a className="btn2" target="_blank" href={`${EXPLORER}/address/${SLA}`}>SLA Guard <ExternalLink size={12} /></a>
      <a className="btn2" target="_blank" href={`${EXPLORER}/address/${ESC}`}>Escrow <ExternalLink size={12} /></a>
    </div>
    {errs.map((e, i) => <p key={i} className="rounded-lg border border-red-800 bg-red-950/40 p-3 text-sm text-red-300">Read error: {e}</p>)}
    <h2 className="font-semibold">SLA claims — live from chain (latest 100)</h2>
    {claims.map((c) => <div key={c.id} className="card text-sm">#{c.id} · {c.status} · HTTP {String(c.status_code)} · {c.incident_id} · <span className="break-all">{c.target_url}</span>{raw(c)}</div>)}
    <h2 className="font-semibold">Escrow deals & AI verdicts — live from chain</h2>
    {deals.map((d) => <div key={d.id} className="card text-sm">Deal #{d.id} · {d.status} · {d.description}{winnerOf(d) && <div className="mt-1 text-emerald-400">AI verdict: {winnerOf(d)} — {d.reasoning}</div>}{raw(d.raw)}</div>)}
    <h2 className="font-semibold">Transactions sent from this browser</h2>
    {!log.length && <p className="text-sm text-slate-500">None yet.</p>}
    {log.map((e, i) => (
      <details key={i} className="card"><summary className="cursor-pointer text-sm">
        {new Date(e.ts).toLocaleString()} · {e.contract}.{e.fn} · <span className={e.status === "accepted" ? "text-emerald-400" : "text-red-400"}>{e.status}</span>
        {e.hash && <> · <a className="text-indigo-400" target="_blank" href={`${EXPLORER}/tx/${e.hash}`}>{e.hash.slice(0, 10)}…</a></>}
      </summary><pre className="mt-3 max-h-80 overflow-auto text-xs">{e.raw}</pre></details>))}
  </>;
}
