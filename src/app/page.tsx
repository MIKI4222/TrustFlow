"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { read, SLA, ESC } from "@/lib/genlayer";
export default function Home() {
  const [stats, setStats] = useState<any>(null);
  const [deals, setDeals] = useState<{ n: number; resolved: number } | null>(null);
  useEffect(() => {
    read(SLA, "get_stats").then(setStats).catch(() => setStats({}));
    (async () => { let n = 0, resolved = 0; try { while (n < 50) { const d: any = await read(ESC, "get_deal", [n]); if (/RESOLVED/i.test(String(d?.status))) resolved++; n++; } } catch {} setDeals({ n, resolved }); })();
  }, []);
  const v = (x: any) => (x === undefined || x === null ? "—" : String(x));
  // wei -> GEN (18 decimals), trimmed; raw wei stays in the tooltip
  const gen = (x: any) => {
    if (x === undefined || x === null) return "—";
    try { const n = BigInt(String(x)); const w = n / 10n ** 18n; const f = (n % 10n ** 18n).toString().padStart(18, "0").slice(0, 4).replace(/0+$/, ""); return `${w}${f ? "." + f : ""} GEN`; } catch { return String(x); }
  };
  const box = (t: string, x: any, title?: string) => <div className="card min-w-0" title={title}><div className="truncate text-xs text-slate-500">{t}</div><div className="mt-1 break-words text-xl font-semibold sm:text-2xl">{x ?? "…"}</div></div>;
  return <>
    <h1 className="text-3xl font-bold">Trustless B2B: SLA enforcement + AI arbitration</h1>
    <p className="text-slate-400">A service breaks its SLA → GenLayer validators check the endpoint themselves and pay compensation. If a result or a delivery is contested, the dispute goes to AI arbitration, which reads both sides' evidence. No middleman.</p>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {box("SLA insurance fund", stats && gen(stats.total_fund ?? stats.fund_balance), stats && `${v(stats.total_fund ?? stats.fund_balance)} wei`)}
      {box("Paid out", stats && gen(stats.total_paid_out), stats && `${v(stats.total_paid_out)} wei`)}
      {box("Escrow deals", deals && deals.n)}
      {box("Disputes resolved by AI", deals && deals.resolved)}
    </div>
    <div className="flex flex-wrap gap-3"><Link className="btn" href="/sla-guard">SLA Guard</Link><Link className="btn" href="/escrow">Escrow</Link><Link className="btn2" href="/audit">Live on-chain audit</Link></div>
    <div className="card text-sm text-slate-400"><b className="text-slate-200">End-to-end flow:</b> 1) a client subscribes to a service (<code>subscribe</code>) → 2) "Trigger Health Check" (<code>report_outage</code>): validators fetch the URL → 3) a recorded SLA claim can be escalated into an Escrow deal/dispute with one click → 4) AI consensus issues a verdict → 5) everything is visible in Audit.</div>
  </>;
}
