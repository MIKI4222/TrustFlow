"use client";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, RefreshCw, XCircle } from "lucide-react";
import type { Deal, Timelocks } from "@/lib/api";
import {
  analyzeEvidenceUrl, evaluateReadiness, readinessFingerprint,
  type CheckLevel, type CheckSource, type CheckStatus, type DealRole, type FieldName, type ReadinessAction, type ReadinessCheck,
  type ReadinessInput, type ReadinessReport,
} from "@/lib/dispute-readiness";
import { EXPECTED_CHAIN_ID, walletChainId } from "@/lib/genlayer";
import { AddressChip, CopyButton } from "./Copy";

// Wallet network, kept current via the wallet's own chainChanged event.
function useChainId() {
  const [id, setId] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const upd = () => { walletChainId().then((n) => { if (alive) setId(n); }); };
    upd();
    const eth = (window as any).ethereum;
    eth?.on?.("chainChanged", upd);
    return () => { alive = false; eth?.removeListener?.("chainChanged", upd); };
  }, []);
  const refresh = async () => { const n = await walletChainId(); setId(n); return n; };
  return [id, refresh] as const;
}

const STATUS_TEXT: Record<CheckStatus, string> = { pass: "Passed", fail: "Action required", warn: "Warning", not_verified: "Not verified", info: "Note" };
const STATUS_CLASS: Record<CheckStatus, string> = { pass: "chk-pass", fail: "chk-fail", warn: "chk-warn", not_verified: "chk-info", info: "chk-info" };
const SOURCE_TEXT: Record<CheckSource, string> = { contract: "Contract rule", app: "App rule", heuristic: "Heuristic" };
const FIELD_TEXT: Record<FieldName, string> = { id: "deal ID", role: "role", url: "evidence URL", claim: "claim" };
const GROUPS: [CheckLevel, string, string][] = [
  ["required", "Required checks", "Must pass before you can continue."],
  ["recommended", "Recommended checks", "Non-blocking: they improve your chances of being understood by the arbitrator."],
  ["prerequisite", "Submission prerequisites", "Wallet, network and contract setup."],
];

function StatusIcon({ s }: { s: CheckStatus }) {
  const p = { size: 16, "aria-hidden": true as const, className: "mt-0.5 shrink-0" };
  return s === "pass" ? <CheckCircle2 {...p} /> : s === "fail" ? <XCircle {...p} /> : s === "warn" ? <AlertTriangle {...p} /> : <Info {...p} />;
}

export type ReadinessPanelProps = {
  action: ReadinessAction;
  role: DealRole;
  dealId: string;
  url: string;
  claim: string;
  deals: Deal[] | null;
  timelocks: Timelocks | null;
  account: string;
  contractAddress: string;
  /** Re-reads deals and time locks from the chain and returns what was read (null = the read failed). */
  onRefresh: () => Promise<{ deals: Deal[] | null; timelocks: Timelocks | null }>;
  onFocusField: (f: FieldName) => void;
  /** The page's EXISTING submission handler. The panel never sends anything itself. */
  onSubmit: () => void;
  submitLabel: string;
  /** Wallet/network transaction in flight: blocks duplicate submissions. */
  busy: boolean;
  /** If set, the user must tick this acknowledgement before submitting (irreversible actions). */
  ackText?: string;
  /** What the next step will call, shown in the review. */
  contractMethod: string;
};

export default function ReadinessPanel(p: ReadinessPanelProps) {
  const [chainId, refreshChain] = useChainId();
  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [ack, setAck] = useState(false);

  const build = (deals: Deal[] | null, timelocks: Timelocks | null, chain: number | null): ReadinessInput => ({
    action: p.action, role: p.role, dealId: p.dealId, url: p.url, claim: p.claim, deals, timelocks,
    account: p.account, chainId: chain, expectedChainId: EXPECTED_CHAIN_ID, contractAddress: p.contractAddress,
  });
  const currentFp = useMemo(
    () => readinessFingerprint(build(p.deals, p.timelocks, chainId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.action, p.role, p.dealId, p.url, p.claim, p.deals, p.timelocks, p.account, p.contractAddress, chainId],
  );
  // A result is only "current" while every input it was computed from is unchanged.
  const stale = !!report && report.fingerprint !== currentFp;

  const run = async () => {
    setChecking(true); setAck(false);
    try {
      const [fresh, chain] = await Promise.all([p.onRefresh(), refreshChain()]);
      setReport(evaluateReadiness(build(fresh.deals, fresh.timelocks, chain)));
    } finally { setChecking(false); }
  };

  const fails = report ? report.checks.filter((c) => c.status === "fail").length : 0;
  const warns = report ? report.checks.filter((c) => c.status === "warn" || (c.status === "not_verified" && c.level !== "recommended")).length : 0;
  const current = !!report && !stale && !checking;
  const needsAck = !!p.ackText;
  const canSubmit = current && report!.canProceed && !p.busy && (!needsAck || ack);
  const why = !report ? "Run the readiness check to enable submission."
    : checking ? "Checking…"
    : stale ? "Your inputs changed since the last check. Re-run it to continue."
    : !report.canProceed ? "Fix the required items above, then re-run the check."
    : p.busy ? "A transaction is already in progress."
    : needsAck && !ack ? "Confirm the acknowledgement above to continue." : "";

  const urlA = analyzeEvidenceUrl(p.url);
  const dataLabel = !report ? "" : report.dataStatus === "READY" ? "Ready" : report.dataStatus === "READY_WITH_WARNINGS" ? "Ready with warnings" : "Not ready";
  const preLabel = !report ? "" : report.prerequisiteStatus === "OK" ? "Satisfied" : report.prerequisiteStatus === "UNVERIFIED" ? "Partly unverified" : "Action required";

  return (
    <section aria-labelledby="readiness-h" className="space-y-3 rounded-xl border border-slate-700 bg-slate-950/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="readiness-h" className="font-semibold">Dispute readiness check</h3>
        <button type="button" className="btn2" onClick={run} disabled={checking || p.busy}>
          {checking ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <RefreshCw size={13} aria-hidden />}
          {report ? "Re-run check" : "Run readiness check"}
        </button>
      </div>
      <p className="text-xs text-slate-500">
        A pre-flight check of your input, the deal's current on-chain state and your wallet. It sends no transaction. <b className="text-slate-300">It is not a guarantee</b> that the transaction will succeed or how the AI arbitrator will decide, and it is not legal advice.
      </p>

      <div role="status" aria-live="polite">
        {checking && <p className="flex items-center gap-2 text-sm"><Loader2 size={16} className="animate-spin" aria-hidden />Checking: re-reading the deal from the chain…</p>}
        {!checking && !report && <p className="text-sm text-slate-400">Not checked yet.</p>}
        {!checking && report && (
          <div className="space-y-1">
            <p className={`flex items-center gap-2 text-base font-semibold ${report.status === "READY" ? "chk-pass" : report.status === "NOT_READY" ? "chk-fail" : "chk-warn"}`}>
              {report.status === "READY" ? <CheckCircle2 size={20} aria-hidden /> : report.status === "NOT_READY" ? <XCircle size={20} aria-hidden /> : <AlertTriangle size={20} aria-hidden />}
              {report.status === "READY" ? "Ready" : report.status === "READY_WITH_WARNINGS" ? "Ready with warnings" : "Not ready"}
              <span className="text-xs font-normal text-slate-400">
                {report.status === "NOT_READY" ? `${fails} required item${fails === 1 ? "" : "s"} to fix` : warns ? `${warns} warning${warns === 1 ? "" : "s"}` : "all required checks passed"}
              </span>
            </p>
            <p className="text-xs text-slate-400">Dispute data: <b className="text-slate-200">{dataLabel}</b> · Submission prerequisites: <b className="text-slate-200">{preLabel}</b></p>
          </div>
        )}
        {stale && <p className="mt-2 rounded border border-amber-700/60 bg-amber-950/30 p-2 text-xs text-amber-200">These results are out of date because the form, wallet or on-chain data changed. Re-run the check.</p>}
      </div>

      {report && !checking && GROUPS.map(([level, title, hint]) => {
        const rows = report.checks.filter((c) => c.level === level);
        if (!rows.length) return null;
        return (
          <div key={level} className={stale ? "opacity-50" : ""}>
            <h4 className="text-sm font-medium">{title}</h4>
            <p className="mb-1 text-xs text-slate-500">{hint}</p>
            <ul className="space-y-1.5">
              {rows.map((c: ReadinessCheck) => (
                <li key={c.id} className="flex gap-2 rounded-lg border border-slate-800 bg-slate-900/50 p-2 text-sm">
                  <span className={STATUS_CLASS[c.status]}><StatusIcon s={c.status} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-medium">{c.label}</span>
                      <span className={`text-xs font-semibold ${STATUS_CLASS[c.status]}`}>{STATUS_TEXT[c.status]}</span>
                      <span className="rounded border border-slate-700 px-1 text-[10px] uppercase tracking-wide text-slate-400">{SOURCE_TEXT[c.source]}</span>
                    </div>
                    <p className="break-words text-xs text-slate-400">{c.message}</p>
                    {c.fix && (c.status === "fail" || c.status === "warn" || c.status === "not_verified") && <p className="break-words text-xs text-slate-300"><b>What to do:</b> {c.fix}</p>}
                    {c.field && (c.status === "fail" || c.status === "warn") && !stale && (
                      <button type="button" className="mt-1 text-xs text-indigo-300 underline" onClick={() => p.onFocusField(c.field!)}>Go to {FIELD_TEXT[c.field]}</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      {current && report!.canProceed && (
        <div className="space-y-2 rounded-lg border border-slate-700 p-3 text-sm">
          <h4 className="font-medium">Review before submitting</h4>
          <dl className="grid gap-x-3 gap-y-1 text-xs sm:grid-cols-[8rem_1fr]">
            <dt className="text-slate-500">Deal</dt><dd>#{p.dealId.trim()}</dd>
            {p.action === "submit_evidence" && <><dt className="text-slate-500">Submitting as</dt><dd>{p.role}</dd></>}
            <dt className="text-slate-500">Wallet</dt><dd>{p.account ? <AddressChip value={p.account} /> : "—"}</dd>
            {p.action === "submit_evidence" && <>
              <dt className="text-slate-500">Claim</dt><dd className="whitespace-pre-wrap break-words">{p.claim.trim()}</dd>
              <dt className="text-slate-500">Evidence URL</dt>
              <dd className="break-all">{urlA.kind === "ok" ? <a className="text-indigo-300 underline" href={urlA.url.href} target="_blank" rel="noopener noreferrer">{p.url.trim()}</a> : p.url.trim()} <CopyButton value={p.url.trim()} label="evidence URL" /></dd>
            </>}
            <dt className="text-slate-500">Pre-flight result</dt><dd>{report!.status === "READY" ? "Ready" : "Ready with warnings"} ({warns} warning{warns === 1 ? "" : "s"})</dd>
          </dl>
          <p className="text-xs text-slate-400">Next step: this calls <code>{p.contractMethod}</code> through the app's existing contract flow. Your wallet will ask you to sign, and the result is shown only after the network reports it.</p>
          {needsAck && <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={ack} onChange={(e) => setAck(e.target.checked)} /><span>{p.ackText}</span></label>}
        </div>
      )}

      <div>
        <button type="button" className="btn" disabled={!canSubmit} aria-describedby="submit-why" onClick={p.onSubmit}>{p.submitLabel}</button>
        <p id="submit-why" className="mt-1 text-xs text-slate-500">{why}</p>
      </div>
    </section>
  );
}
