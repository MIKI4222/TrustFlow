"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { read, SLA, ESC } from "@/lib/genlayer";
import { getStats, getDeals, formatGen } from "@/lib/api";
export default function Home() {
  const [stats, setStats] = useState<any>(null);
  const [deals, setDeals] = useState<{ n: number; resolved: number; locked: bigint } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    getStats(read, SLA).then(setStats).catch((e) => setErr(`get_stats failed: ${e.message}`));
    getDeals(read, ESC).then((d) => setDeals({ n: d.length, resolved: d.filter((x) => x.status.startsWith("RESOLVED")).length, locked: d.filter((x) => !x.paid).reduce((s, x) => s + BigInt(x.amount || 0), 0n) })).catch((e) => setErr((p) => `${p} get_all_deals failed: ${e.message}`));
  }, []);
  const gen = formatGen;
  const box = (t: string, x: any, title?: string) => <div className="card min-w-0" title={title}><div className="truncate text-xs text-slate-500">{t}</div><div className="mt-1 break-words text-xl font-semibold sm:text-2xl">{x ?? "…"}</div></div>;
  return <>
    <h1 className="text-3xl font-bold">Trustless B2B: SLA enforcement + AI arbitration</h1>
    <p className="text-slate-400">A service breaks its SLA → GenLayer validators check the endpoint themselves and pay compensation from the provider's fund. If a delivery is contested, the dispute goes to AI arbitration, which reads both sides' evidence. No middleman.</p>
    {err && <p className="rounded-lg border border-red-800 bg-red-950/40 p-3 text-sm text-red-300">Read error: {err}</p>}
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {box("SLA insurance fund", stats && gen(stats.total_fund), stats && `${stats.total_fund} wei`)}
      {box("Paid out", stats && gen(stats.total_paid_out), stats && `${stats.total_paid_out} wei`)}
      {box("Held in escrow", deals && formatGen(deals.locked.toString()), deals && `${deals.locked} wei`)}
      {box("Escrow deals", deals && deals.n)}
      {box("Disputes resolved by AI", deals && deals.resolved)}
    </div>
    <div className="flex flex-wrap gap-3"><Link className="btn" href="/sla-guard">SLA Guard</Link><Link className="btn" href="/escrow">Escrow</Link><Link className="btn2" href="/audit">Live on-chain audit</Link></div>
    <div className="card text-sm text-slate-400"><b className="text-slate-200">End-to-end flow:</b> 1) a client subscribes to a service (<code>subscribe</code>, pays the premium) → 2) "Trigger Health Check" (<code>report_outage</code>): validators fetch the URL → 3) a recorded SLA claim can be escalated into an Escrow deal with one click → 4) both sides submit evidence and AI consensus issues a verdict (<code>resolve_dispute</code>) → 5) everything is visible in Audit. <b className="text-slate-200">Custody:</b> both contracts hold native tokens. The SLA pool pays outage claims; the escrow takes a deposit equal to the deal amount (<code>create_deal</code> is payable) and pays it out on release, AI verdict, or time-locked recovery.</div>
  </>;
}
