"use client";
import { useEffect, useState } from "react";
import { read, write, ESC, Stage } from "@/lib/genlayer";
import { getDeals, getTimelocks, createDeal, releaseFunds, submitEvidence, cancelStalledDispute, resolveStalledArbitration, resolveDispute, dealKind, winnerOf, stalledInfo, toWei, formatGen, Deal, Timelocks, Writer } from "@/lib/api";
import { useWallet } from "@/components/Wallet";
import TxStatus from "@/components/TxStatus";
import ReadinessPanel from "@/components/ReadinessPanel";
import { AddressChip } from "@/components/Copy";
import type { FieldName } from "@/lib/dispute-readiness";
export default function Escrow() {
  const { account, connect } = useWallet();
  const [deals, setDeals] = useState<Deal[] | null>(null); // null = not loaded / last read failed
  const [tl, setTl] = useState<Timelocks | null>(null);
  const [filter, setFilter] = useState("All");
  const [f, setF] = useState({ freelancer: "", description: "", amountGen: "0.01" });
  const [mode, setMode] = useState<"submit_evidence" | "resolve_dispute">("submit_evidence");
  const [ev, setEv] = useState({ id: "0", url: "", claim: "", role: "client" as "client" | "freelancer" });
  const [stage, setStage] = useState<Stage>("idle");
  const [detail, setDetail] = useState("");
  const [msg, setMsg] = useState("");
  const [loadErr, setLoadErr] = useState("");
  const [from, setFrom] = useState("");
  // Re-reads deals + time locks and returns exactly what was read (null = that read failed), so the
  // readiness check evaluates fresh on-chain state and never treats stale data as verified.
  const refresh = async () => {
    const errs: string[] = [];
    let d: Deal[] | null = null, t: Timelocks | null = null;
    try { d = await getDeals(read, ESC); } catch (e: any) { errs.push(`get_all_deals: ${e.message}`); }
    try { t = await getTimelocks(read, ESC); } catch (e: any) { errs.push(`get_timelocks: ${e.message}`); }
    setDeals(d); setTl(t); setLoadErr(errs.join(" | "));
    return { deals: d, timelocks: t };
  };
  const load = async () => { await refresh(); };
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
  const busy = stage === "broadcast" || stage === "consensus" || stage === "reasoning";
  const focusField = (f: FieldName) => document.getElementById(`ev-${f}`)?.focus();
  const when = (t: number) => new Date(t * 1000).toLocaleString();
  return <>
    <h1 className="text-2xl font-bold">AI Arbitration Escrow</h1>
    <p className="rounded-lg border border-amber-700/50 bg-amber-950/30 p-3 text-xs text-amber-200">Custody: <code>create_deal</code> is payable. The attached value must exactly equal the deal amount, and the contract holds it until the client releases it, the AI verdict pays the winner, or a time-locked recovery pays the client. Evidence must be URLs of static pages (validators may not read SPAs).{tl && tl.now === 0 && <> <b>Warning: the consensus clock is unavailable ({tl.clock_source}); time-locked actions cannot be verified.</b></>}</p>
    {from && <p className="card text-sm text-indigo-300">Deal created from SLA incident: {from}</p>}
    {loadErr && <p className="rounded-lg border border-red-800 bg-red-950/40 p-3 text-sm text-red-300">Read error: {loadErr}</p>}
    <div className="card space-y-3">
      <h2 className="font-semibold">Create deal (you become the client and deposit the amount)</h2>
      <input className="inp" aria-label="Freelancer address 0x… (must differ from your wallet)" placeholder="Freelancer address 0x… (must differ from your wallet)" value={f.freelancer} onChange={(e) => setF({ ...f, freelancer: e.target.value })} />
      <textarea className="inp" aria-label="Scope / acceptance criteria" placeholder="Scope / acceptance criteria" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      <input className="inp" aria-label="Deposit in GEN, e.g. 0.01" placeholder="Deposit in GEN, e.g. 0.01" value={f.amountGen} onChange={(e) => setF({ ...f, amountGen: e.target.value })} />
      <p className="text-xs text-slate-500">{wei ? `Sends exactly ${wei} wei (${formatGen(wei)}) with the transaction.` : "Enter a positive amount in GEN."}</p>
      <button className="btn" disabled={!wei} onClick={() => run(() => createDeal(w, ESC, { freelancer: f.freelancer, description: f.description, amountWei: toWei(f.amountGen) }, account))}>create_deal (deposit {formatGen(wei)})</button>
    </div>
    <div className="card space-y-3">
      <h2 className="font-semibold">Dispute: submit evidence / resolve</h2>
      <p className="text-xs text-slate-500">Client evidence opens the dispute (client wallet). The freelancer then submits theirs (freelancer wallet). Anyone can call resolve once both are in. Run the readiness check first: evidence cannot be edited by the client once submitted.</p>
      <div className="seg" role="group" aria-label="Dispute action">
        <button type="button" aria-pressed={mode === "submit_evidence"} onClick={() => setMode("submit_evidence")}>Submit evidence</button>
        <button type="button" aria-pressed={mode === "resolve_dispute"} onClick={() => setMode("resolve_dispute")}>Resolve dispute</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div><label className="field-label" htmlFor="ev-id">Deal ID</label><input id="ev-id" className="inp" inputMode="numeric" placeholder="0" value={ev.id} onChange={(e) => setEv({ ...ev, id: e.target.value })} /></div>
        {mode === "submit_evidence" && <>
          <div><label className="field-label" htmlFor="ev-role">Submitting as</label><select id="ev-role" className="inp" value={ev.role} onChange={(e) => setEv({ ...ev, role: e.target.value as "client" | "freelancer" })}><option value="client">Client</option><option value="freelancer">Freelancer</option></select></div>
          <div><label className="field-label" htmlFor="ev-url">Evidence URL (public static page)</label><input id="ev-url" className="inp" type="url" placeholder="https://…" value={ev.url} onChange={(e) => setEv({ ...ev, url: e.target.value })} /></div>
        </>}
      </div>
      {mode === "submit_evidence" && <div><label className="field-label" htmlFor="ev-claim">Claim</label><textarea id="ev-claim" className="inp min-h-[5rem]" placeholder="What was agreed, and what was or was not delivered?" value={ev.claim} onChange={(e) => setEv({ ...ev, claim: e.target.value })} /></div>}
      <ReadinessPanel key={mode} action={mode} role={ev.role} dealId={ev.id} url={ev.url} claim={ev.claim}
        deals={deals} timelocks={tl} account={account} contractAddress={ESC} onRefresh={refresh} onFocusField={focusField} busy={busy}
        contractMethod={mode === "resolve_dispute" ? "resolve_dispute" : ev.role === "client" ? "submit_client_evidence" : "submit_freelancer_evidence"}
        submitLabel={mode === "resolve_dispute" ? "Resolve dispute (AI verdict)" : ev.role === "client" ? "Submit client evidence" : "Submit freelancer evidence"}
        ackText={mode === "resolve_dispute" ? "I understand the AI verdict pays the whole escrowed amount to the winner and cannot be undone." : ev.role === "client" ? "I understand client evidence can be submitted only once and cannot be changed afterwards." : undefined}
        onSubmit={() => run(() => mode === "resolve_dispute" ? resolveDispute(w, ESC, id) : submitEvidence(w, ESC, ev.role, id, ev.url, ev.claim))} />
      <TxStatus stage={stage} detail={detail} />{msg && <p role="alert" className="text-sm text-red-400">{msg}</p>}
    </div>
    <div className="flex gap-2">{["All", "Active", "Disputed", "Completed"].map((k) => <button key={k} className={`btn2 ${filter === k ? "bg-slate-800" : ""}`} onClick={() => setFilter(k)}>{k}</button>)}</div>
    {(deals ?? []).filter((d) => filter === "All" || dealKind(d) === filter).map((d) => {
      const st = tl ? stalledInfo(d, tl) : null;
      return (
      <div key={d.id} className="card space-y-2">
        <div className="flex justify-between"><b>Deal #{d.id}</b><span className="text-xs text-indigo-300">{d.status} · {dealKind(d)}</span></div>
        <p className="break-words text-sm text-slate-400">{d.description}</p>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500"><span>Client <AddressChip value={d.client} /></span><span>Freelancer <AddressChip value={d.freelancer} /></span></p>
        <p className="text-xs text-slate-500" title={`${d.amount} wei`}>{formatGen(d.amount)} {d.paid ? "· paid out" : "· held in escrow"}</p>
        {winnerOf(d) && <div className="rounded bg-slate-950 p-3 text-xs"><b className="text-emerald-400">Outcome: {winnerOf(d)}</b> — {d.reasoning}</div>}
        {d.status === "FUNDED" && <button className="btn2" onClick={() => run(() => releaseFunds(w, ESC, d.id))}>release_funds (client)</button>}
        {st && <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <button className="btn2" onClick={() => run(() => st.fn === "cancel_stalled_dispute" ? cancelStalledDispute(w, ESC, d.id) : resolveStalledArbitration(w, ESC, d.id))}>{st.fn}</button>
          {st.ready ? "available now" : st.at > 0 ? `available after ${when(st.at)}` : "time not recorded"}
        </div>}
        <details className="text-xs text-slate-500"><summary className="cursor-pointer">raw on-chain record</summary><pre className="overflow-auto">{JSON.stringify(d.raw, null, 2)}</pre></details>
      </div>); })}
    {!(deals ?? []).length && !loadErr && <p className="text-sm text-slate-500">No deals yet.</p>}
  </>;
}
