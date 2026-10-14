// Pure contract-facing logic (no browser / SDK imports) so the workflows can be tested
// against the exact method signatures of the deployed contracts.

export type Reader = (address: string, fn: string, args?: any[]) => Promise<any>;
export type Writer = (address: string, fn: string, args: any[], value?: bigint) => Promise<any>;

// get_claims_history(limit: int) REQUIRES the limit argument.
export const CLAIMS_LIMIT = 50;

export const parse = (v: any) => { if (typeof v === "string") { try { return JSON.parse(v); } catch { return v; } } return v; };

// Contract list views return list[str] where each item is a JSON string.
// Never swallow problems: anything that is not a list is an error, not "empty".
export function parseList(v: any, what: string): any[] {
  const x = parse(v);
  if (!Array.isArray(x)) throw new Error(`${what}: expected a list from the contract, got ${typeof x}`);
  return x.map(parse);
}

export type Deal = ReturnType<typeof normDeal>;
// Escrow v4 deal record: id, client, freelancer, description, amount (wei, custodied), status, client/freelancer evidence + claim,
// resolution_reasoning, created_time, dispute_start_time, freelancer_evidence_time, resolved_time, paid.
export function normDeal(id: number, d: any) {
  const x = d || {};
  return {
    id, raw: x,
    status: String(x.status ?? ""), client: String(x.client ?? ""), freelancer: String(x.freelancer ?? ""),
    description: String(x.description ?? ""), amount: String(x.amount ?? ""),
    cUrl: String(x.client_evidence_url ?? ""), cClaim: String(x.client_claim ?? ""),
    fUrl: String(x.freelancer_evidence_url ?? ""), fClaim: String(x.freelancer_claim ?? ""),
    reasoning: String(x.resolution_reasoning ?? ""),
    paid: Boolean(x.paid), disputeStart: Number(x.dispute_start_time ?? 0), fTime: Number(x.freelancer_evidence_time ?? 0),
  };
}
// Statuses: FUNDED | DISPUTED | RELEASED_TO_FREELANCER | RESOLVED_FOR_CLIENT | RESOLVED_FOR_FREELANCER
export const dealKind = (d: { status: string }) =>
  /^(RELEASED|RESOLVED)/.test(d.status) ? "Completed" : d.status === "DISPUTED" ? "Disputed" : "Active";
export const winnerOf = (d: { status: string }) =>
  d.status === "RESOLVED_FOR_FREELANCER" ? "freelancer" : d.status === "RESOLVED_FOR_CLIENT" ? "client" : "";

// ---------- reads (errors propagate to the UI) ----------
export const getStats = async (read: Reader, sla: string) => parse(await read(sla, "get_stats"));
export const getServices = async (read: Reader, sla: string) => parseList(await read(sla, "get_services"), "get_services");
export const getClaims = async (read: Reader, sla: string, limit = CLAIMS_LIMIT) =>
  parseList(await read(sla, "get_claims_history", [limit]), "get_claims_history");
export const getDeals = async (read: Reader, esc: string): Promise<Deal[]> =>
  parseList(await read(esc, "get_all_deals"), "get_all_deals").map((d, i) => normDeal(i, d));

// ---------- SLA Guard writes ----------
export async function subscribe(read: Reader, write: Writer, sla: string, url: string) {
  const premium = BigInt(String(await read(sla, "get_premium_amount")));
  return write(sla, "subscribe", [url], premium); // payable: value must be >= premium
}
export async function reportOutage(read: Reader, write: Writer, sla: string, url: string, account: string) {
  // is_eligible is a free view: explain a guaranteed revert instead of sending a doomed transaction.
  const e = parse(await read(sla, "is_eligible", [url, account]));
  if (e && e.eligible === false) throw new Error(`Not eligible: ${e.reason}`);
  return write(sla, "report_outage", [url], 0n);
}
export const addService = (write: Writer, sla: string, url: string) => write(sla, "add_monitored_service", [url], 0n);
export const depositFunds = (write: Writer, sla: string, wei: bigint) => write(sla, "deposit_funds", [], wei);

// ---------- money helpers ----------
// "0.25" GEN -> 250000000000000000n wei (exact, no floating point).
export function toWei(gen: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,18}))?$/.exec(String(gen).trim());
  if (!m) throw new Error("Enter a positive amount in GEN, e.g. 0.05");
  return BigInt(m[1]) * 10n ** 18n + BigInt((m[2] ?? "").padEnd(18, "0"));
}
export function formatGen(x: any): string {
  if (x === undefined || x === null || x === "") return "—";
  try { const n = BigInt(String(x)); const f = (n % 10n ** 18n).toString().padStart(18, "0").slice(0, 4).replace(/0+$/, ""); return `${n / 10n ** 18n}${f ? "." + f : ""} GEN`; } catch { return String(x); }
}

// ---------- Escrow writes (arbitration_escrow.py v4) ----------
// create_deal is PAYABLE and requires the attached value to EXACTLY equal the stated amount (wei),
// which the contract custodies until release / verdict / time-locked recovery.
export function createDeal(write: Writer, esc: string, p: { freelancer: string; description: string; amountWei: bigint }, account = "") {
  if (p.amountWei <= 0n) throw new Error("Amount must be greater than zero");
  if (!p.freelancer.trim()) throw new Error("Freelancer address cannot be empty");
  if (!p.description.trim()) throw new Error("Description cannot be empty");
  if (account && account.toLowerCase() === p.freelancer.trim().toLowerCase()) throw new Error("Client and freelancer must be different accounts");
  return write(esc, "create_deal", [p.freelancer.trim(), p.description.trim(), p.amountWei], p.amountWei);
}
export const releaseFunds = (write: Writer, esc: string, id: number) => write(esc, "release_funds", [id], 0n);
export function submitEvidence(write: Writer, esc: string, role: "client" | "freelancer", id: number, url: string, claim: string) {
  if (!url.trim() || !claim.trim()) throw new Error("Evidence URL and claim cannot be empty");
  return write(esc, role === "client" ? "submit_client_evidence" : "submit_freelancer_evidence", [id, url.trim(), claim.trim()], 0n);
}
export const cancelStalledDispute = (write: Writer, esc: string, id: number) => write(esc, "cancel_stalled_dispute", [id], 0n);
export const resolveStalledArbitration = (write: Writer, esc: string, id: number) => write(esc, "resolve_stalled_arbitration", [id], 0n);
export const resolveDispute = (write: Writer, esc: string, id: number) => write(esc, "resolve_dispute", [id], 0n);

// ---------- time locks (get_timelocks view) ----------
export type Timelocks = { now: number; clock_source: string; dispute_cancel_delay_seconds: number; arbitration_recovery_delay_seconds: number };
export const getTimelocks = async (read: Reader, esc: string): Promise<Timelocks> => parse(await read(esc, "get_timelocks"));
// Which time-locked escape hatch (if any) applies to a disputed deal, and when it opens.
export function stalledInfo(d: Deal, tl: Timelocks) {
  if (d.status !== "DISPUTED") return null;
  const fn = d.fUrl ? "resolve_stalled_arbitration" : "cancel_stalled_dispute";
  const at = d.fUrl ? d.fTime + tl.arbitration_recovery_delay_seconds : d.disputeStart + tl.dispute_cancel_delay_seconds;
  return { fn, at, ready: tl.now > 0 && at > 0 && tl.now >= at };
}

// ---------- SLA claim -> Escrow dispute ----------
export function escalationFromClaim(c: any) {
  const ref = `SLA Guard claim #${c.id} (incident ${c.incident_id}): ${c.target_url} -> ${c.status}, HTTP ${c.status_code}`;
  return { ref, description: `SLA dispute. ${ref}. Provider must deliver service per SLA.`, claim: `Service violated SLA. On-chain verdict: ${ref}` };
}
