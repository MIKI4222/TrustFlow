"use client";
import { useEffect, useState } from "react";
import { read, write, ESC, Stage, normDeal } from "@/lib/genlayer";
import { useWallet } from "@/components/Wallet";
import TxStatus from "@/components/TxStatus";
const kind = (d: any) => /RESOLVED|RELEASED/i.test(d.status) ? "Completed" : (d.cUrl || d.fUrl) ? "Disputed" : "Active";
export default function Escrow() {
  const { account, connect } = useWallet();
  const [deals, setDeals] = useState<any[]>([]);
  const [filter, setFilter] = useState("All");
  const [f, setF] = useState({ freelancer: "", description: "", amount: "100" });
  const [ev, setEv] = useState({ id: "0", url: "", claim: "", role: "client" });
  const [stage, setStage] = useState<Stage>("idle");
  const [msg, setMsg] = useState("");
  const [detail, setDetail] = useState("");
  const [from, setFrom] = useState("");
  const load = async () => { const out: any[] = []; try { for (let i = 0; i < 50; i++) out.push(normDeal(i, await read(ESC, "get_deal", [i]))); } catch {} setDeals(out); };
  useEffect(() => {
    load();
    const q = new URLSearchParams(window.location.search);
    if (q.get("claim")) {
      const t = `SLA Guard claim #${q.get("claim")} (incident ${q.get("incident")}): ${q.get("url")} -> ${q.get("status")}, HTTP ${q.get("code")}`;
      setFrom(t);
      setF((x) => ({ ...x, description: `SLA dispute. ${t}. Provider must deliver service per SLA.` }));
      setEv((x) => ({ ...x, claim: `Service violated SLA. On-chain verdict: ${t}` }));
    }
  }, []);
  const run = async (fn: string, args: any[]) => {
    if (!account) return connect();
    setMsg("");
    try { await write(ESC, fn, args, account, (s, d) => { setStage(s); setDetail(d || ""); }); load(); } catch (e: any) { setMsg(e.message); }
  };
  return <>
    <h1 className="text-2xl font-bold">AI Arbitration Escrow</h1>
    <p className="rounded-lg border border-amber-700/50 bg-amber-950/30 p-3 text-xs text-amber-200">Контракт фиксирует сделку, доказательства и ИИ-вердикт on-chain; сумма <code>amount</code> — учётное значение, контракт не удерживает токены. Доказательства — URL статических страниц (SPA валидаторы могут не прочитать).</p>
    {from && <p className="card text-sm text-indigo-300">Сделка создаётся из SLA-инцидента: {from}</p>}
    <div className="card space-y-3">
      <h2 className="font-semibold">Create deal</h2>
      <input className="inp" placeholder="Freelancer address 0x…" value={f.freelancer} onChange={(e) => setF({ ...f, freelancer: e.target.value })} />
      <textarea className="inp" placeholder="Scope / acceptance criteria" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      <input className="inp" placeholder="Amount (integer)" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
      <button className="btn" onClick={() => run("create_deal", [f.freelancer, f.description, Number(f.amount)])}>create_deal</button>
    </div>
    <div className="card space-y-3">
      <h2 className="font-semibold">Raise dispute / submit evidence</h2>
      <div className="grid gap-2 sm:grid-cols-3">
        <input className="inp" placeholder="Deal ID" value={ev.id} onChange={(e) => setEv({ ...ev, id: e.target.value })} />
        <select className="inp" value={ev.role} onChange={(e) => setEv({ ...ev, role: e.target.value })}><option value="client">Client</option><option value="freelancer">Freelancer</option></select>
        <input className="inp" placeholder="Evidence URL (static page)" value={ev.url} onChange={(e) => setEv({ ...ev, url: e.target.value })} />
      </div>
      <textarea className="inp" placeholder="Claim" value={ev.claim} onChange={(e) => setEv({ ...ev, claim: e.target.value })} />
      <div className="flex gap-2">
        <button className="btn" onClick={() => run(`submit_${ev.role}_evidence`, [Number(ev.id), ev.url, ev.claim])}>Submit evidence</button>
        <button className="btn2" onClick={() => run("resolve_dispute", [Number(ev.id)])}>resolve_dispute (AI verdict)</button>
      </div>
      <TxStatus stage={stage} detail={detail} />{msg && <p className="text-sm text-red-400">{msg}</p>}
    </div>
    <div className="flex gap-2">{["All", "Active", "Disputed", "Completed"].map((k) => <button key={k} className={`btn2 ${filter === k ? "bg-slate-800" : ""}`} onClick={() => setFilter(k)}>{k}</button>)}</div>
    {deals.filter((d) => filter === "All" || kind(d) === filter).map((d) => (
      <div key={d.id} className="card space-y-2">
        <div className="flex justify-between"><b>Deal #{d.id}</b><span className="text-xs text-indigo-300">{d.status} · {kind(d)}</span></div>
        <p className="text-sm text-slate-400">{d.description} · amount {String(d.amount)}</p>
        {d.verdict && <div className="rounded bg-slate-950 p-3 text-xs"><b className="text-emerald-400">AI verdict:</b> {d.verdict}</div>}
        <details className="text-xs text-slate-500"><summary className="cursor-pointer">raw on-chain record</summary><pre className="overflow-auto">{JSON.stringify(d.raw, null, 2)}</pre></details>
        {kind(d) === "Active" && <button className="btn2" onClick={() => run("release_funds", [d.id])}>release_funds</button>}
      </div>))}
  </>;
}
