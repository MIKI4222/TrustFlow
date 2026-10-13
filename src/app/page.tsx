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
  const box = (t: string, x: any) => <div className="card"><div className="text-xs text-slate-500">{t}</div><div className="mt-1 text-2xl font-semibold">{x ?? "…"}</div></div>;
  return <>
    <h1 className="text-3xl font-bold">Trustless B2B: SLA enforcement + AI arbitration</h1>
    <p className="text-slate-400">A service breaks its SLA → GenLayer validators check the endpoint themselves and pay compensation. If a result or a delivery is contested, the dispute goes to AI arbitration, which reads both sides' evidence. No middleman.</p>
    <div className="grid gap-4 sm:grid-cols-4">
      {box("SLA insurance fund (wei)", stats && v(stats.total_fund ?? stats.fund_balance))}
      {box("Paid out (wei)", stats && v(stats.total_paid_out))}
      {box("Escrow deals", deals && deals.n)}
      {box("Disputes resolved by AI", deals && deals.resolved)}
    </div>
    <div className="flex flex-wrap gap-3"><Link className="btn" href="/sla-guard">SLA Guard</Link><Link className="btn" href="/escrow">Escrow</Link><Link className="btn2" href="/audit">Live on-chain audit</Link></div>
    <div className="card text-sm text-slate-400"><b className="text-slate-200">End-to-end flow:</b> 1) a client subscribes to a service (<code>subscribe</code>) → 2) "Trigger Health Check" (<code>report_outage</code>): validators fetch the URL → 3) a recorded SLA claim can be escalated into an Escrow deal/dispute with one click → 4) AI consensus issues a verdict → 5) everything is visible in Audit.</div>
  </>;
}
