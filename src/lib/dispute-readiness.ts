// Dispute Readiness Check: a PRE-FLIGHT validation for the two dispute actions of the deployed
// Escrow contract (arbitration_escrow.py v4):
//   - submit_client_evidence / submit_freelancer_evidence(deal_id, evidence_url, claim)
//   - resolve_dispute(deal_id)
//
// Design rules (see docs/MILESTONE_UX2.md):
//   * Pure and deterministic: no SDK, no browser, no network, no clock. Everything it needs is passed in,
//     so it can be unit-tested and can never send a transaction or fetch an arbitrary URL (no SSRF surface).
//   * Every rule says where it comes from: "contract" (the contract asserts it), "app" (an application
//     rule the contract does not enforce) or "heuristic" (a best-effort hint that can be wrong).
//   * READY is a pre-flight result, NOT a guarantee that the transaction or the AI verdict will succeed.
import type { Deal, Timelocks } from "./api";

// The contract reads only the first 6000 characters of each evidence page (gl.nondet.web.render(...)[:6000]).
export const EVIDENCE_READ_LIMIT_CHARS = 6000;
export const CLAIM_RECOMMENDED_MIN = 20;
export const CLAIM_RECOMMENDED_MAX = 1500;

export type ReadinessAction = "submit_evidence" | "resolve_dispute";
export type DealRole = "client" | "freelancer";
export type FieldName = "id" | "role" | "url" | "claim";
export type CheckLevel = "required" | "recommended" | "prerequisite";
export type CheckSource = "contract" | "app" | "heuristic";
// pass: satisfied. fail: blocks submission. warn: non-blocking problem.
// not_verified: this tool could not verify it. info: a fact worth knowing, never a problem.
export type CheckStatus = "pass" | "fail" | "warn" | "not_verified" | "info";
// CHECKING is a UI state while on-chain data is being re-read; evaluateReadiness never returns it.
export type ReadinessStatus = "READY" | "READY_WITH_WARNINGS" | "NOT_READY" | "CHECKING";

export interface ReadinessCheck {
  id: string;
  level: CheckLevel;
  source: CheckSource;
  label: string;
  status: CheckStatus;
  message: string;
  fix?: string;
  field?: FieldName;
}

export interface ReadinessInput {
  action: ReadinessAction;
  role: DealRole;
  dealId: string;            // raw text from the form
  url: string;               // raw evidence URL (submit_evidence only)
  claim: string;             // raw claim (submit_evidence only)
  deals: Deal[] | null;      // null = could not be read from the chain
  timelocks?: Timelocks | null;
  account: string;           // connected wallet ("" = not connected)
  chainId: number | null;    // wallet's current chain id, null = unknown
  expectedChainId: number | null;
  contractAddress: string;
}

export interface ReadinessReport {
  status: Exclude<ReadinessStatus, "CHECKING">;
  /** Readiness of the dispute data itself (required + recommended checks). */
  dataStatus: Exclude<ReadinessStatus, "CHECKING">;
  /** Wallet / network / contract prerequisites, reported separately from the data. */
  prerequisiteStatus: "OK" | "ACTION_REQUIRED" | "UNVERIFIED";
  checks: ReadinessCheck[];
  fingerprint: string;
  canProceed: boolean;
}

// ---------- helpers ----------
export function parseDealId(text: string): number | null {
  const t = String(text ?? "").trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

const COMPLETED = /^(RELEASED|RESOLVED)/;

export function isNonPublicHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (h === "localhost" || /\.(localhost|local|internal|lan)$/.test(h) || h.endsWith(".home.arpa")) return true;
  if (h.startsWith("[")) { // IPv6 literal
    const v6 = h.slice(1, -1);
    return v6 === "::1" || v6 === "::" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith("::ffff:");
  }
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  return !h.includes("."); // single-label names such as "intranet" are not publicly resolvable
}

export type UrlAnalysis =
  | { kind: "empty" }
  | { kind: "invalid" }
  | { kind: "bad_protocol"; protocol: string }
  | { kind: "credentials" }
  | { kind: "non_public_host"; host: string }
  | { kind: "ok"; url: URL; secure: boolean };

/** Syntax-only analysis. It never fetches anything and proves nothing about reachability. */
export function analyzeEvidenceUrl(raw: string): UrlAnalysis {
  const t = String(raw ?? "").trim();
  if (!t) return { kind: "empty" };
  let u: URL;
  try { u = new URL(t); } catch { return { kind: "invalid" }; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { kind: "bad_protocol", protocol: u.protocol };
  if (u.username || u.password) return { kind: "credentials" };
  if (isNonPublicHost(u.hostname)) return { kind: "non_public_host", host: u.hostname };
  return { kind: "ok", url: u, secure: u.protocol === "https:" };
}

const BINARY_EXT = /\.(pdf|png|jpe?g|gif|webp|svg|zip|rar|7z|mp4|mov|mp3|wav|docx?|xlsx?|pptx?)$/i;
const LOGIN_PRONE_HOSTS = /(^|\.)(docs\.google\.com|drive\.google\.com|notion\.so|notion\.site|dropbox\.com|figma\.com|onedrive\.live\.com|sharepoint\.com)$/i;

/** Best-effort hints about pages that validators often cannot read as text. Heuristic, can be wrong. */
export function urlHints(u: URL): string[] {
  const out: string[] = [];
  if (BINARY_EXT.test(u.pathname)) out.push("the link points to a file (PDF, image, archive or office document); validators read pages as text");
  if (LOGIN_PRONE_HOSTS.test(u.hostname)) out.push(`${u.hostname} pages often need a login or JavaScript, so validators may see a login page instead of your evidence`);
  if (/^#\/|^#!/.test(u.hash)) out.push("the link uses a hash route, which usually means a client-side app that validators may not render");
  return out;
}

const canon = (u: URL) => `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`;
const lc = (s: string) => String(s ?? "").trim().toLowerCase();
const mk = (c: ReadinessCheck): ReadinessCheck => c;

// ---------- shared prerequisite checks (wallet / network / contract) ----------
function prerequisites(i: ReadinessInput, party?: { deal?: Deal; role: DealRole }): ReadinessCheck[] {
  const out: ReadinessCheck[] = [];
  const connected = !!i.account.trim();
  out.push(mk({ id: "wallet", level: "prerequisite", source: "app", label: "Wallet connected",
    status: connected ? "pass" : "fail",
    message: connected ? "A wallet is connected." : "No wallet is connected.",
    fix: connected ? undefined : "Connect your wallet with the button in the header." }));

  if (i.expectedChainId === null) {
    out.push(mk({ id: "network", level: "prerequisite", source: "app", label: "Correct network", status: "not_verified",
      message: "The expected network id is not available from the SDK configuration, so the network was not verified." }));
  } else if (i.chainId === null) {
    out.push(mk({ id: "network", level: "prerequisite", source: "app", label: "Correct network", status: "not_verified",
      message: "The wallet's current network could not be read.", fix: "Connect your wallet, then re-run the check." }));
  } else if (i.chainId !== i.expectedChainId) {
    out.push(mk({ id: "network", level: "prerequisite", source: "app", label: "Correct network", status: "fail",
      message: `The wallet is on chain ${i.chainId}; this app targets GenLayer Bradbury Testnet (chain ${i.expectedChainId}).`,
      fix: "Switch your wallet to GenLayer Bradbury Testnet, then re-run the check." }));
  } else {
    out.push(mk({ id: "network", level: "prerequisite", source: "app", label: "Correct network", status: "pass",
      message: `The wallet is on GenLayer Bradbury Testnet (chain ${i.expectedChainId}).` }));
  }

  const addrOk = /^0x[0-9a-fA-F]{40}$/.test(i.contractAddress);
  out.push(mk({ id: "contract_config", level: "prerequisite", source: "app", label: "Escrow contract configured",
    status: addrOk ? "pass" : "fail",
    message: addrOk ? `Escrow contract address is configured (${i.contractAddress}).` : "The escrow contract address is missing or malformed.",
    fix: addrOk ? undefined : "Set NEXT_PUBLIC_ESCROW_ADDRESS to a valid 0x… address and rebuild." }));

  if (party) {
    const want = party.role;
    const need = party.deal ? (want === "client" ? party.deal.client : party.deal.freelancer) : "";
    let status: CheckStatus, message: string, fix: string | undefined;
    if (!party.deal) { status = "not_verified"; message = "The deal could not be loaded, so the wallet's role in it was not verified."; }
    else if (!connected) { status = "not_verified"; message = `Connect a wallet to verify that it is the ${want} of deal #${party.deal.id}.`; }
    else if (lc(i.account) === lc(need)) { status = "pass"; message = `The connected wallet is the ${want} of deal #${party.deal.id}.`; }
    else { status = "fail"; message = `The contract only accepts ${want} evidence from the deal's ${want} (${need}); the connected wallet is ${i.account}.`; fix = `Switch to the ${want} account, or change the role above.`; }
    out.push(mk({ id: "wallet_role", level: "prerequisite", source: "contract", label: `Wallet is the ${want}`, status, message, fix, field: "role" }));
  }
  return out;
}

// ---------- deal lookup (shared) ----------
function dealLookup(i: ReadinessInput): { checks: ReadinessCheck[]; deal?: Deal } {
  const checks: ReadinessCheck[] = [];
  const id = parseDealId(i.dealId);
  if (id === null) {
    checks.push(mk({ id: "deal_id", level: "required", source: "contract", label: "Deal ID", status: "fail", field: "id",
      message: "The deal ID must be a whole number (0, 1, 2 …).", fix: "Enter the numeric ID shown on the deal card." }));
    return { checks };
  }
  checks.push(mk({ id: "deal_id", level: "required", source: "contract", label: "Deal ID", status: "pass", field: "id", message: `Deal ID ${id} is a valid number.` }));
  if (i.deals === null) {
    checks.push(mk({ id: "deal_exists", level: "required", source: "contract", label: "Deal exists on-chain", status: "not_verified", field: "id",
      message: "Deals could not be read from the chain, so the deal's state was not verified.", fix: "Re-run the check; if it keeps failing, the RPC endpoint may be unavailable." }));
    return { checks };
  }
  const deal = i.deals.find((d) => d.id === id);
  if (!deal) {
    checks.push(mk({ id: "deal_exists", level: "required", source: "contract", label: "Deal exists on-chain", status: "fail", field: "id",
      message: `Deal #${id} does not exist (the chain currently has ${i.deals.length} deal${i.deals.length === 1 ? "" : "s"}).`, fix: "Check the deal ID." }));
    return { checks };
  }
  checks.push(mk({ id: "deal_exists", level: "required", source: "contract", label: "Deal exists on-chain", status: "pass", field: "id", message: `Deal #${id} found (status ${deal.status}).` }));
  return { checks, deal };
}

// ---------- submit evidence ----------
function evaluateSubmit(i: ReadinessInput): ReadinessCheck[] {
  const { checks, deal } = dealLookup(i);
  const role = i.role;

  if (deal) {
    const done = COMPLETED.test(deal.status);
    let ok = false, message = "", fix: string | undefined;
    if (role === "client") {
      ok = deal.status === "FUNDED";
      message = ok ? "The deal is FUNDED, so the client can raise a dispute." :
        deal.status === "DISPUTED" ? "A dispute is already open. Client evidence can only be submitted once and cannot be replaced." :
        done ? `The deal is already completed (${deal.status}).` : `The deal is not open for client evidence (status ${deal.status}).`;
    } else {
      ok = deal.status === "DISPUTED";
      message = ok ? "The deal is DISPUTED, so the freelancer can answer." :
        deal.status === "FUNDED" ? "The client has not raised a dispute yet, so there is nothing to answer." :
        done ? `The deal is already completed (${deal.status}).` : `The deal is not open for freelancer evidence (status ${deal.status}).`;
    }
    checks.push(mk({ id: "deal_state", level: "required", source: "contract", label: "Deal state allows this evidence", status: ok ? "pass" : "fail", field: "id", message, fix: ok ? undefined : fix }));
  }

  const claimOk = i.claim.trim().length > 0;
  checks.push(mk({ id: "claim", level: "required", source: "contract", label: "Claim written", field: "claim",
    status: claimOk ? "pass" : "fail",
    message: claimOk ? "The claim is not empty." : "The claim is empty or contains only whitespace.",
    fix: claimOk ? undefined : "Describe what was agreed and why the other side's position is wrong." }));

  const ua = analyzeEvidenceUrl(i.url);
  const urlPresent = ua.kind !== "empty";
  checks.push(mk({ id: "url_present", level: "required", source: "contract", label: "Evidence URL provided", field: "url",
    status: urlPresent ? "pass" : "fail",
    message: urlPresent ? "An evidence URL is provided." : "The evidence URL is empty or contains only whitespace.",
    fix: urlPresent ? undefined : "Paste the link to a static page that supports your claim." }));
  if (urlPresent) {
    let message = "", fix: string | undefined, ok = false;
    switch (ua.kind) {
      case "invalid": message = "This is not a valid absolute URL."; fix = "Include the scheme, e.g. https://example.com/evidence."; break;
      case "bad_protocol": message = `The protocol ${ua.protocol} is not supported; validators fetch http(s) pages.`; fix = "Use an https:// link."; break;
      case "credentials": message = "The URL contains a username or password. Do not publish credentials in evidence links."; fix = "Use a link that does not embed credentials."; break;
      case "non_public_host": message = `${ua.host} is not a public host; the validator network cannot reach it.`; fix = "Host the evidence on a publicly reachable page."; break;
      default: ok = true; message = "The URL is syntactically valid and points to a public host (syntax only; reachability is not verified)."; }
    checks.push(mk({ id: "url_format", level: "required", source: "app", label: "Evidence URL is well-formed", field: "url", status: ok ? "pass" : "fail", message, fix }));
  }

  // ---- recommended ----
  if (ua.kind === "ok") {
    if (!ua.secure) checks.push(mk({ id: "url_https", level: "recommended", source: "app", label: "Uses HTTPS", status: "warn", field: "url",
      message: "The URL uses plain http://. The contract accepts it, but https:// is more reliable and tamper-resistant.", fix: "Use the https:// version of the page if one exists." }));
    if (/\s/.test(i.url.trim())) checks.push(mk({ id: "url_spaces", level: "recommended", source: "app", label: "No spaces in URL", status: "warn", field: "url",
      message: "The URL contains spaces. The contract stores the text exactly as entered.", fix: "Encode spaces as %20." }));
    const hints = urlHints(ua.url);
    checks.push(mk({ id: "url_readable", level: "recommended", source: "heuristic", label: "Page looks readable as text", field: "url",
      status: hints.length ? "warn" : "pass",
      message: hints.length ? `Possible problem: ${hints.join("; ")}.` : "No known unreadable-page patterns detected (heuristic; this does not prove validators can read the page).",
      fix: hints.length ? "Prefer a static, server-rendered page that shows the evidence as plain text." : undefined }));
    const other = deal ? (role === "freelancer" ? deal.cUrl : deal.fUrl) : "";
    const otherUa = other ? analyzeEvidenceUrl(other) : null;
    if (otherUa && otherUa.kind === "ok" && canon(otherUa.url) === canon(ua.url)) {
      checks.push(mk({ id: "url_duplicate", level: "recommended", source: "app", label: "Evidence differs from the other side's", status: "warn", field: "url",
        message: "This URL is the same as the other party's evidence URL, so the arbitrator would read the same page for both sides.", fix: "Use a page that contains your own evidence." }));
    }
  }
  if (claimOk) {
    const len = i.claim.trim().length;
    const short = len < CLAIM_RECOMMENDED_MIN, long = len > CLAIM_RECOMMENDED_MAX;
    checks.push(mk({ id: "claim_quality", level: "recommended", source: "heuristic", label: "Claim length is reasonable", field: "claim",
      status: short || long ? "warn" : "pass",
      message: short ? `The claim is very short (${len} characters). The arbitrator also reads the deal description, so say what was agreed and what was or was not delivered.` :
        long ? `The claim is long (${len} characters) and is inserted into the arbitrator's prompt. Concise claims are easier to evaluate.` : `The claim is ${len} characters long.`,
      fix: short || long ? "Aim for a few clear sentences." : undefined }));
  }
  if (deal && role === "freelancer" && deal.status === "DISPUTED" && deal.fUrl) {
    checks.push(mk({ id: "overwrite", level: "recommended", source: "contract", label: "No earlier freelancer evidence", status: "warn", field: "url",
      message: "Freelancer evidence is already recorded. The contract does not block a second submission; it overwrites the earlier evidence and restarts the arbitration timer.", fix: "Submit again only if you intend to replace the earlier evidence." }));
  }
  const tl = i.timelocks;
  if (deal && role === "freelancer" && deal.status === "DISPUTED" && !deal.fUrl && tl && tl.now > 0 && deal.disputeStart > 0 && tl.now >= deal.disputeStart + tl.dispute_cancel_delay_seconds) {
    checks.push(mk({ id: "window_expired", level: "recommended", source: "contract", label: "Response window", status: "warn",
      message: `The ${Math.round(tl.dispute_cancel_delay_seconds / 86400)}-day response window has passed. The client can already cancel the dispute and recover the escrow; your evidence is still accepted until they do.` }));
  }
  checks.push(mk({ id: "accessibility", level: "recommended", source: "app", label: "Evidence page reachable by validators", status: "not_verified", field: "url",
    message: "Not verified. A browser cannot reliably check whether the validator network can read a third-party page, so no request is made. Open the link in a private window to confirm it is public." }));
  checks.push(mk({ id: "read_limit", level: "recommended", source: "contract", label: "Page length", status: "info", field: "url",
    message: `Validators read only the first ${EVIDENCE_READ_LIMIT_CHARS} characters of each evidence page. Put the decisive facts at the top.` }));

  checks.push(...prerequisites(i, { deal, role }));
  return checks;
}

// ---------- resolve dispute ----------
function evaluateResolve(i: ReadinessInput): ReadinessCheck[] {
  const { checks, deal } = dealLookup(i);
  if (deal) {
    const ok = deal.status === "DISPUTED";
    checks.push(mk({ id: "deal_state", level: "required", source: "contract", label: "Deal is under dispute", status: ok ? "pass" : "fail", field: "id",
      message: ok ? "The deal is DISPUTED." : COMPLETED.test(deal.status) ? `The deal is already completed (${deal.status}); resolve_dispute would revert.` : `The deal is not under dispute (status ${deal.status}); resolve_dispute would revert.` }));
    const hasF = deal.fUrl.trim().length > 0;
    checks.push(mk({ id: "both_evidence", level: "required", source: "contract", label: "Both sides submitted evidence", status: hasF ? "pass" : "fail", field: "id",
      message: hasF ? "Client and freelancer evidence are both on record." : "The freelancer has not submitted evidence yet; resolve_dispute would revert.",
      fix: hasF ? undefined : "Wait for the freelancer's evidence (the client can recover the escrow after the time lock if none arrives)." }));
    if (hasF && deal.cUrl) {
      const a = analyzeEvidenceUrl(deal.cUrl), b = analyzeEvidenceUrl(deal.fUrl);
      if (a.kind === "ok" && b.kind === "ok" && canon(a.url) === canon(b.url)) {
        checks.push(mk({ id: "url_duplicate", level: "recommended", source: "app", label: "Evidence pages differ", status: "warn", message: "Both sides point to the same page, so the arbitrator has no distinguishing evidence." }));
      }
      const hints = [a, b].flatMap((x, n) => (x.kind === "ok" ? urlHints(x.url).map((h) => `${n === 0 ? "client" : "freelancer"} evidence: ${h}`) : []));
      checks.push(mk({ id: "url_readable", level: "recommended", source: "heuristic", label: "Evidence pages look readable as text", status: hints.length ? "warn" : "pass",
        message: hints.length ? `Possible problem: ${hints.join("; ")}.` : "No known unreadable-page patterns detected (heuristic only)." }));
    }
    checks.push(mk({ id: "accessibility", level: "recommended", source: "app", label: "Evidence pages reachable by validators", status: "not_verified",
      message: "Not verified. If validators cannot read a page, the arbitrator decides on missing evidence, which usually hurts the party whose page is unreadable." }));
    checks.push(mk({ id: "irreversible", level: "recommended", source: "contract", label: "Outcome is final", status: "info",
      message: "A successful resolution pays the whole escrowed amount to the winner and cannot be undone. The verdict is an AI consensus result, not legal advice." }));
  }
  checks.push(...prerequisites(i));
  return checks;
}

// ---------- status model ----------
// Form values may arrive as undefined/null from loosely-typed callers; treat them as empty text.
const normalize = (i: ReadinessInput): ReadinessInput => ({
  ...i, dealId: String(i.dealId ?? ""), url: String(i.url ?? ""), claim: String(i.claim ?? ""), account: String(i.account ?? ""),
  contractAddress: String(i.contractAddress ?? ""),
});

const counts = (c: ReadinessCheck) => c.status === "warn" || (c.status === "not_verified" && c.level !== "recommended");
const rollup = (cs: ReadinessCheck[]): Exclude<ReadinessStatus, "CHECKING"> =>
  cs.some((c) => c.status === "fail") ? "NOT_READY" : cs.some(counts) ? "READY_WITH_WARNINGS" : "READY";

export function readinessFingerprint(input: ReadinessInput): string {
  const i = normalize(input);
  const id = parseDealId(i.dealId);
  const d = id !== null && i.deals ? i.deals.find((x) => x.id === id) : undefined;
  const tl = i.timelocks;
  return JSON.stringify([i.action, i.role, i.dealId, i.url, i.claim, lc(i.account), i.chainId, i.expectedChainId, i.contractAddress,
    i.deals === null ? "unloaded" : i.deals.length,
    d ? [d.status, d.client, d.freelancer, d.cUrl, d.fUrl, d.paid, d.disputeStart, d.fTime] : null,
    tl ? [tl.dispute_cancel_delay_seconds, tl.arbitration_recovery_delay_seconds, tl.now > 0] : null]);
}

export function evaluateReadiness(input: ReadinessInput): ReadinessReport {
  const i = normalize(input);
  const checks = i.action === "submit_evidence" ? evaluateSubmit(i) : evaluateResolve(i);
  const data = checks.filter((c) => c.level !== "prerequisite");
  const pre = checks.filter((c) => c.level === "prerequisite");
  const status = rollup(checks);
  return {
    status, checks, fingerprint: readinessFingerprint(i),
    dataStatus: rollup(data),
    prerequisiteStatus: pre.some((c) => c.status === "fail") ? "ACTION_REQUIRED" : pre.some((c) => c.status === "not_verified") ? "UNVERIFIED" : "OK",
    canProceed: status !== "NOT_READY",
  };
}
