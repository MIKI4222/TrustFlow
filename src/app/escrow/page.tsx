"use client";
import { useEffect, useState } from "react";
import { read, write, ESC, Stage } from "@/lib/genlayer";
import { getDeals, getTimelocks, createDeal, releaseFunds, submitEvidence, cancelStalledDispute, resolveStalledArbitration, resolveDispute, dealKind, winnerOf, stalledInfo, toWei, formatGen, Deal, Timelocks, Writer } from "@/lib/api";
import { useWallet } from "@/components/Wallet";
import TxStatus from "@/components/TxStatus";
export default function Escrow() {
  const { account, connect } = useWallet();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [tl, setTl] = useState<Timelocks | null>(null);
  const [filter, setFilter] = useState("All");
  const [f, setF] = useState({ freelancer: "", description: "", amountGen: "0.01" });
  const [ev, setEv] = useState({ id: "0", url: "", claim: "", role: "client" as "client" | "freelancer" });
  const [stage, setStage] = useState<Stage>("idle");
  const [detail, setDetail] = useState("");
  const [msg, setMsg] = useState("");
  const [loadErr, setLoadErr] = useState("");
  const [from, setFrom] = useState("");
  const load = async () => {
    const errs: string[] = [];
    await getDeals(read, ESC).then(setDeals).catch((e) => errs.push(`get_all_deals: ${e.message}`));
    await getTimelocks(read, ESC).then(setTl).catch((e) => errs.push(`get_timelocks: ${e.message}`));
    setLoadErr(errs.join(" | "));
  };
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
  const w: Writer = (a, fn, args, v = 0n) => write(a, fn, args, account, (s, d) => { setStage(s); setDetail(d || ""); }, v);
  const run = async (fn: () => Promise<any>) => {
    if (!account) return connect();
    setMsg("");
    try { await fn(); await load(); } catch (e: any) { setMsg(e.message); }
  };
  let wei = ""; try { wei = toWei(f.amountGen).toString(); } catch { /* shown as invalid below */ }
  const id = Number(ev.id);
  const when = (t: number) => new Date(t * 1000).toLocaleString();
  return <>
    <h1 className="text-2xl font-bold">AI Arbitration Escrow</h1>
    <p className="rounded-lg border border-amber-700/50 bg-amber-950/30 p-3 text-xs text-amber-200">Custody: <code>create_deal</code> is payable. The attached value must exactly equal the deal amount, and the contract holds it until the client releases it, the AI verdict pays the winner, or a time-locked recovery pays the client. Evidence must be URLs of static pages (validators may not read SPAs).{tl && tl.now === 0 && <> <b>Warning: the consensus clock is unavailable ({tl.clock_source}); time-locked actions cannot be verified.</b></>}</p>
    {from && <p className="card text-sm text-indigo-300">Deal created from SLA incident: {from}</p>}
    {loadErr && <p className="rounded-lg border border-red-800 bg-red-950/40 p-3 text-sm text-red-300">Read error: {loadErr}</p>}
    <div className="card space-y-3">
      <h2 className="font-semibold">Create deal (you become the client and deposit the amount)</h2>
      <input className="inp" placeholder="Freelancer address 0x… (must differ from your wallet)" value={f.freelancer} onChange={(e) => setF({ ...f, freelancer: e.target.value })} />
      <textarea className="inp" placeholder="Scope / acceptance criteria" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      <input className="inp" placeholder="Deposit in GEN, e.g. 0.01" value={f.amountGen} onChange={(e) => setF({ ...f, amountGen: e.target.value })} />
      <p className="text-xs text-slate-500">{wei ? `Sends exactly ${wei} wei (${formatGen(wei)}) with the transaction.` : "Enter a positive amount in GEN."}</p>
      <button className="btn" disabled={!wei} onClick={() => run(() => createDeal(w, ESC, { freelancer: f.freelancer, description: f.description, amountWei: toWei(f.amountGen) }, account))}>create_deal (deposit {formatGen(wei)})</button>
    </div>
    <div className="card space-y-3">
      <h2 className="font-semibold">Dispute: submit evidence / resolve</h2>
      <p className="text-xs text-slate-500">Client evidence opens the dispute (client wallet). The freelancer then submits theirs (freelancer wallet). Anyone can call resolve once both are in.</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <input className="inp" placeholder="Deal ID" value={ev.id} onChange={(e) => setEv({ ...ev, id: e.target.value })} />
        <select className="inp" value={ev.role} onChange={(e) => setEv({ ...ev, role: e.target.value as "client" | "freelancer" })}><option value="client">Client</option><option value="freelancer">Freelancer</option></select>
        <input className="inp" placeholder="Evidence URL (static page)" value={ev.url} onChange={(e) => setEv({ ...ev, url: e.target.value })} />
      </div>
      <textarea className="inp" placeholder="Claim" value={ev.claim} onChange={(e) => setEv({ ...ev, claim: e.target.value })} />
      <div className="flex flex-wrap gap-2">
        <button className="btn" onClick={() => run(() => submitEvidence(w, ESC, ev.role, id, ev.url, ev.claim))}>Submit evidence</button>
        <button className="btn2" onClick={() => run(() => resolveDispute(w, ESC, id))}>resolve_dispute (AI verdict)</button>
      </div>
      <TxStatus stage={stage} detail={detail} />{msg && <p className="text-sm text-red-400">{msg}</p>}
    </div>
    <div className="flex gap-2">{["All", "Active", "Disputed", "Completed"].map((k) => <button key={k} className={`btn2 ${filter === k ? "bg-slate-800" : ""}`} onClick={() => setFilter(k)}>{k}</button>)}</div>
    {deals.filter((d) => filter === "All" || dealKind(d) === filter).map((d) => {
      const st = tl ? stalledInfo(d, tl) : null;
      return (
      <div key={d.id} className="card space-y-2">
        <div className="flex justify-between"><b>Deal #{d.id}</b><span className="text-xs text-indigo-300">{d.status} · {dealKind(d)}</span></div>
        <p className="break-words text-sm text-slate-400">{d.description}</p>
        <p className="text-xs text-slate-500" title={`${d.amount} wei`}>{formatGen(d.amount)} {d.paid ? "· paid out" : "· held in escrow"}</p>
        {winnerOf(d) && <div className="rounded bg-slate-950 p-3 text-xs"><b className="text-emerald-400">Outcome: {winnerOf(d)}</b> — {d.reasoning}</div>}
        {d.status === "FUNDED" && <button className="btn2" onClick={() => run(() => releaseFunds(w, ESC, d.id))}>release_funds (client)</button>}
        {st && <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <button className="btn2" onClick={() => run(() => st.fn === "cancel_stalled_dispute" ? cancelStalledDispute(w, ESC, d.id) : resolveStalledArbitration(w, ESC, d.id))}>{st.fn}</button>
          {st.ready ? "available now" : st.at > 0 ? `available after ${when(st.at)}` : "time not recorded"}
        </div>}
        <details className="text-xs text-slate-500"><summary className="cursor-pointer">raw on-chain record</summary><pre className="overflow-auto">{JSON.stringify(d.raw, null, 2)}</pre></details>
      </div>); })}
    {!deals.length && !loadErr && <p className="text-sm text-slate-500">No deals yet.</p>}
  </>;
}
