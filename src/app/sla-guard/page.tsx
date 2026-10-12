"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { read, write, SLA, Stage } from "@/lib/genlayer";
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
  const load = () => {
    read(SLA, "get_services").then((r) => setServices(Array.isArray(r) ? r : [])).catch(() => {});
    read(SLA, "get_claims_history").then((r) => setClaims(Array.isArray(r) ? r : [])).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  const run = async (fn: string, args: any[], value = 0n) => {
    if (!account) return connect();
    setMsg("");
    try { await write(SLA, fn, args, account, (s, d) => { setStage(s); setDetail(d || ""); }, value); load(); } catch (e: any) { setMsg(e.message); }
  };
  const premium = async () => BigInt(String(await read(SLA, "get_premium_amount")));
  const esc = (c: any) => "/escrow/?" + new URLSearchParams({ claim: String(c.id), incident: String(c.incident_id), url: String(c.target_url), status: String(c.status), code: String(c.status_code) });
  return <>
    <h1 className="text-2xl font-bold">SLA Guard Center</h1>
    <p className="text-sm text-slate-500">Вердикт строится по реальному HTTP-ответу, который запрашивают валидаторы (5xx / маркеры сбоя / недоступность). Регистрация сервисов и пополнение фонда доступны владельцу контракта; клиент подписывается и подаёт claim.</p>
    <div className="card space-y-3">
      <h2 className="font-semibold">Service & fund (owner)</h2>
      <input className="inp" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://service.example/health" />
      <input className="inp" value={fund} onChange={(e) => setFund(e.target.value)} placeholder="Deposit to insurance fund (wei)" />
      <div className="flex gap-2">
        <button className="btn" onClick={() => run("add_monitored_service", [url])}>add_monitored_service</button>
        <button className="btn2" onClick={() => run("deposit_funds", [], BigInt(fund || 0))}>deposit_funds</button>
      </div>
      <TxStatus stage={stage} detail={detail} />{msg && <p className="text-sm text-red-400">{msg}</p>}
    </div>
    <div className="space-y-3">
      {services.map((s: any, i) => { const u = s.url || s.target_url || s; return (
        <div key={i} className="card flex flex-wrap items-center justify-between gap-3">
          <div><div className="font-mono text-sm">{String(u)}</div><div className="text-xs text-slate-500">incident {s.incident_id ?? "—"} · {s.incident_state ?? "—"} · payouts {s.incident_payouts ?? 0}</div></div>
          <div className="flex gap-2">
            <button className="btn2" onClick={async () => run("subscribe", [u], await premium())}>Subscribe</button>
            <button className="btn" onClick={() => run("report_outage", [u])}>Trigger Health Check</button>
          </div>
        </div>); })}
      {!services.length && <p className="text-sm text-slate-500">Нет зарегистрированных сервисов.</p>}
    </div>
    <h2 className="text-lg font-semibold">Claims (on-chain)</h2>
    {claims.map((c: any) => (
      <div key={c.id} className="card flex flex-wrap items-center justify-between gap-3 text-sm">
        <div><b>#{c.id}</b> · <span className={c.status === "approved" ? "text-emerald-400" : "text-amber-400"}>{c.status}</span> · HTTP {String(c.status_code)} · incident {c.incident_id}<div className="font-mono text-xs text-slate-500">{c.target_url} · payout {String(c.payout)}</div></div>
        <Link className="btn2" href={esc(c)}>Escalate to AI arbitration →</Link>
      </div>))}
  </>;
}
