"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { read, write, SLA, Stage } from "@/lib/genlayer";
import { getServices, getClaims, subscribe, reportOutage, addService, depositFunds, escalationFromClaim, Writer } from "@/lib/api";
import { useWallet } from "@/components/Wallet";
import TxStatus from "@/components/TxStatus";
export default function SlaGuard() {
  const { account, connect } = useWallet();
  const [services, setServices] = useState<any[]>([]);
  const [claims, setClaims] = useState<any[]>([]);
  const [url, setUrl] = useState("https://httpbin.org/status/500");
  const [fund, setFund] = useState("0");
  const [stage, setStage] = useState<Stage>("idle");
  const [detail, setDetail] = useState("");
  const [msg, setMsg] = useState("");
  const [loadErr, setLoadErr] = useState("");
  const load = async () => {
    setLoadErr("");
    const errs: string[] = [];
    await getServices(read, SLA).then(setServices).catch((e) => errs.push(`get_services: ${e.message}`));
    await getClaims(read, SLA).then(setClaims).catch((e) => errs.push(`get_claims_history: ${e.message}`));
    setLoadErr(errs.join(" | "));
  };
  useEffect(() => { load(); }, []);
  const w: Writer = (a, fn, args, v = 0n) => write(a, fn, args, account, (s, d) => { setStage(s); setDetail(d || ""); }, v);
  const run = async (f: () => Promise<any>) => {
    if (!account) return connect();
    setMsg("");
    try { await f(); await load(); } catch (e: any) { setMsg(e.message); }
  };
  const esc = (c: any) => "/escrow/?" + new URLSearchParams({ claim: String(c.id), incident: String(c.incident_id), url: String(c.target_url), status: String(c.status), code: String(c.status_code) });
  return <>
    <h1 className="text-2xl font-bold">SLA Guard Center</h1>
    <p className="text-sm text-slate-500">The verdict is based on the real HTTP response that validators fetch (5xx / failure markers / unreachable). Registering services and funding the pool is owner-only; clients subscribe (premium) and file claims.</p>
    {loadErr && <p className="rounded-lg border border-red-800 bg-red-950/40 p-3 text-sm text-red-300">Read error: {loadErr}</p>}
    <div className="card space-y-3">
      <h2 className="font-semibold">Service & fund (owner)</h2>
      <input className="inp" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://service.example/health" />
      <input className="inp" value={fund} onChange={(e) => setFund(e.target.value)} placeholder="Deposit to insurance fund (wei)" />
      <div className="flex gap-2">
        <button className="btn" onClick={() => run(() => addService(w, SLA, url))}>add_monitored_service</button>
        <button className="btn2" onClick={() => run(() => depositFunds(w, SLA, BigInt(fund || 0)))}>deposit_funds</button>
      </div>
      <TxStatus stage={stage} detail={detail} />{msg && <p className="text-sm text-red-400">{msg}</p>}
    </div>
    <div className="space-y-3">
      {services.map((s: any) => (
        <div key={s.id} className="card flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0"><div className="break-all font-mono text-sm">{s.url}</div><div className="text-xs text-slate-500">{s.active ? "active" : "inactive"} · incident {s.incident_id || `${s.id}:${s.incident_seq}`} · {s.incident_state} · payouts {s.incident_payouts}</div></div>
          <div className="flex gap-2">
            <button className="btn2" onClick={() => run(() => subscribe(read, w, SLA, s.url))}>Subscribe</button>
            <button className="btn" onClick={() => run(() => reportOutage(read, w, SLA, s.url, account))}>Trigger Health Check</button>
          </div>
        </div>))}
      {!services.length && !loadErr && <p className="text-sm text-slate-500">No services registered yet.</p>}
    </div>
    <h2 className="text-lg font-semibold">Claims (on-chain, latest 50)</h2>
    {claims.map((c: any) => (
      <div key={c.id} className="card flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="min-w-0"><b>#{c.id}</b> · <span className={c.status === "approved" ? "text-emerald-400" : "text-amber-400"}>{c.status}</span> · HTTP {String(c.status_code)} · incident {c.incident_id}<div className="break-all font-mono text-xs text-slate-500">{c.target_url} · payout {String(c.payout)} wei · {c.reason}</div></div>
        <Link className="btn2" href={esc(c)}>Escalate to AI arbitration →</Link>
      </div>))}
    {!claims.length && !loadErr && <p className="text-sm text-slate-500">No claims yet.</p>}
  </>;
}
