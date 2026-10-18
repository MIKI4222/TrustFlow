import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normDeal } from "../src/lib/api.ts";
import {
  evaluateReadiness, readinessFingerprint, analyzeEvidenceUrl, isNonPublicHost, parseDealId,
  CLAIM_RECOMMENDED_MAX, type ReadinessInput, type ReadinessReport,
} from "../src/lib/dispute-readiness.ts";

const CLIENT = "0x1111111111111111111111111111111111111111";
const FREELANCER = "0x2222222222222222222222222222222222222222";
const ESC = "0xE6f098D1B49d67390bFec8C8169aeFd99868878f";
const CHAIN = 4221; // arbitrary test value; the module compares ids, it does not hardcode a network
const CLAIM = "The delivered site does not match the agreed acceptance criteria.";
const URL_OK = "https://example.com/evidence/client";

const deal = (o: object = {}) => normDeal(0, { client: CLIENT, freelancer: FREELANCER, status: "FUNDED", description: "Build a site", amount: "1000", paid: false, ...o });
const base = (o: Partial<ReadinessInput> = {}): ReadinessInput => ({
  action: "submit_evidence", role: "client", dealId: "0", url: URL_OK, claim: CLAIM,
  deals: [deal()], timelocks: { now: 1000, clock_source: "test", dispute_cancel_delay_seconds: 604800, arbitration_recovery_delay_seconds: 259200 },
  account: CLIENT, chainId: CHAIN, expectedChainId: CHAIN, contractAddress: ESC, ...o,
});
const get = (r: ReadinessReport, id: string) => r.checks.find((c) => c.id === id);
const failing = (r: ReadinessReport) => r.checks.filter((c) => c.status === "fail").map((c) => c.id);

test("1. complete valid dispute data is READY (accessibility stays 'not verified' and does not downgrade it)", () => {
  const r = evaluateReadiness(base());
  assert.equal(r.status, "READY");
  assert.equal(r.dataStatus, "READY");
  assert.equal(r.prerequisiteStatus, "OK");
  assert.equal(r.canProceed, true);
  assert.equal(get(r, "accessibility")!.status, "not_verified"); // never reported as a pass
});

test("2. missing required field (deal id) is NOT_READY and points at the field", () => {
  const r = evaluateReadiness(base({ dealId: "abc" }));
  assert.equal(r.status, "NOT_READY");
  assert.equal(get(r, "deal_id")!.status, "fail");
  assert.equal(get(r, "deal_id")!.field, "id");
  assert.equal(evaluateReadiness(base({ dealId: "-1" })).status, "NOT_READY");
  assert.equal(evaluateReadiness(base({ dealId: "1.5" })).status, "NOT_READY");
  assert.equal(parseDealId(" 7 "), 7);
});

test("2b. deal that does not exist on-chain is a failure; unreadable chain is 'not verified', not a pass", () => {
  assert.deepEqual(failing(evaluateReadiness(base({ dealId: "5" }))), ["deal_exists"]);
  const r = evaluateReadiness(base({ deals: null }));
  assert.equal(get(r, "deal_exists")!.status, "not_verified");
  assert.equal(r.status, "READY_WITH_WARNINGS"); // we cannot claim READY without verifying on-chain state
});

test("3. whitespace-only claim fails (contract: claim.strip() must be non-empty)", () => {
  const r = evaluateReadiness(base({ claim: "  \n\t " }));
  assert.equal(r.status, "NOT_READY");
  assert.equal(get(r, "claim")!.status, "fail");
  assert.equal(get(r, "claim")!.source, "contract");
});

test("4. empty evidence URL fails (contract rule), whitespace-only too", () => {
  for (const url of ["", "   "]) {
    const r = evaluateReadiness(base({ url }));
    assert.equal(get(r, "url_present")!.status, "fail");
    assert.equal(get(r, "url_present")!.source, "contract");
    assert.equal(r.status, "NOT_READY");
  }
});

test("5. malformed evidence URL fails as an app rule (the contract would accept it)", () => {
  const r = evaluateReadiness(base({ url: "example.com/page" }));
  assert.equal(get(r, "url_format")!.status, "fail");
  assert.equal(get(r, "url_format")!.source, "app");
  assert.equal(r.status, "NOT_READY");
});

test("6. unsupported protocols, embedded credentials and non-public hosts are rejected", () => {
  for (const url of ["ftp://example.com/x", "javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd", "https://user:pw@example.com/x",
    "http://localhost:3000/x", "http://127.0.0.1/x", "https://192.168.1.5/x", "http://10.0.0.1/x", "http://[::1]/x", "http://intranet/x", "http://2130706433/x"]) {
    assert.equal(evaluateReadiness(base({ url })).status, "NOT_READY", url);
  }
  assert.equal(isNonPublicHost("8.8.8.8"), false);
  assert.equal(isNonPublicHost("172.32.0.1"), false); // outside 172.16/12
  assert.equal(isNonPublicHost("172.16.0.1"), true);
});

test("7. duplicate evidence URL (same as the other side's) is a warning, not a failure", () => {
  const d = deal({ status: "DISPUTED", client_evidence_url: "https://example.com/evidence/client/", client_claim: "x" });
  const r = evaluateReadiness(base({ role: "freelancer", account: FREELANCER, deals: [d], url: "https://EXAMPLE.com/evidence/client" }));
  assert.equal(get(r, "url_duplicate")!.status, "warn");
  assert.equal(r.status, "READY_WITH_WARNINGS");
});

test("8. missing wallet: data is READY but submission prerequisites require action (reported separately)", () => {
  const r = evaluateReadiness(base({ account: "" }));
  assert.equal(r.dataStatus, "READY");
  assert.equal(r.prerequisiteStatus, "ACTION_REQUIRED");
  assert.equal(r.status, "NOT_READY");
  assert.equal(get(r, "wallet")!.status, "fail");
});

test("9. wrong network blocks; unknown network is only 'not verified'", () => {
  const wrong = evaluateReadiness(base({ chainId: 1 }));
  assert.equal(get(wrong, "network")!.status, "fail");
  assert.equal(wrong.status, "NOT_READY");
  const unknown = evaluateReadiness(base({ chainId: null }));
  assert.equal(get(unknown, "network")!.status, "not_verified");
  assert.equal(unknown.status, "READY_WITH_WARNINGS");
  assert.equal(unknown.prerequisiteStatus, "UNVERIFIED");
});

test("10. missing or malformed contract configuration blocks", () => {
  for (const contractAddress of ["", "0x123", "not-an-address"]) {
    const r = evaluateReadiness(base({ contractAddress }));
    assert.equal(get(r, "contract_config")!.status, "fail");
    assert.equal(r.status, "NOT_READY");
  }
});

test("11. non-blocking warnings: http, hard-to-read hosts, file links, very short claim", () => {
  const r = evaluateReadiness(base({ url: "http://example.com/report.pdf", claim: "Bad work." }));
  assert.equal(get(r, "url_https")!.status, "warn");
  assert.equal(get(r, "url_readable")!.status, "warn");
  assert.equal(get(r, "claim_quality")!.status, "warn");
  assert.equal(r.canProceed, true);
  assert.equal(evaluateReadiness(base({ url: "https://docs.google.com/document/d/abc" })).status, "READY_WITH_WARNINGS");
});

test("12. READY / READY_WITH_WARNINGS / NOT_READY are distinguished", () => {
  assert.equal(evaluateReadiness(base()).status, "READY");
  assert.equal(evaluateReadiness(base({ url: "http://example.com/x" })).status, "READY_WITH_WARNINGS");
  assert.equal(evaluateReadiness(base({ url: "" })).status, "NOT_READY");
  // a failure always wins over warnings
  assert.equal(evaluateReadiness(base({ url: "http://localhost/x", claim: "short" })).status, "NOT_READY");
});

test("13. results go stale when relevant inputs or on-chain state change", () => {
  const i = base();
  const fp = evaluateReadiness(i).fingerprint;
  assert.equal(fp, readinessFingerprint({ ...i })); // deterministic
  for (const change of [{ url: URL_OK + "2" }, { claim: CLAIM + "." }, { dealId: "1" }, { role: "freelancer" as const }, { account: FREELANCER },
    { chainId: 1 }, { deals: [deal({ status: "DISPUTED" })] }, { deals: null }, { action: "resolve_dispute" as const }]) {
    assert.notEqual(readinessFingerprint({ ...i, ...change }), fp, JSON.stringify(Object.keys(change)));
  }
  // address case does not matter, a moving clock does not invalidate
  assert.equal(readinessFingerprint({ ...i, account: CLIENT.toUpperCase().replace("0X", "0x") }), fp);
  assert.equal(readinessFingerprint({ ...i, timelocks: { ...i.timelocks!, now: 99999 } }), fp);
});

test("14. optional/odd inputs do not crash: huge claim, unicode, odd whitespace, null-ish strings", () => {
  assert.doesNotThrow(() => evaluateReadiness(base({ claim: "я".repeat(5000), url: "https://пример.рф/доказательство" })));
  assert.equal(evaluateReadiness(base({ url: "https://пример.рф/доказательство" })).status, "READY");
  assert.equal(get(evaluateReadiness(base({ url: "https://example.com/a b" })), "url_spaces")!.status, "warn");
  assert.doesNotThrow(() => evaluateReadiness(base({ url: undefined as any, claim: undefined as any, dealId: undefined as any })));
});

test("15. boundaries: the contract has NO length limits, so long claims only warn (recommendation at 1500)", () => {
  const at = evaluateReadiness(base({ claim: "x".repeat(CLAIM_RECOMMENDED_MAX) }));
  const over = evaluateReadiness(base({ claim: "x".repeat(CLAIM_RECOMMENDED_MAX + 1) }));
  assert.equal(get(at, "claim_quality")!.status, "pass");
  assert.equal(get(over, "claim_quality")!.status, "warn");
  assert.equal(over.canProceed, true); // never blocks: not a contract rule
  assert.equal(get(evaluateReadiness(base({ claim: "x" })), "claim")!.status, "pass"); // 1 char satisfies the contract
});

// ---- contract state rules (read from arbitration_escrow.py) ----
test("client evidence is only allowed while FUNDED and only from the client wallet", () => {
  const disputed = evaluateReadiness(base({ deals: [deal({ status: "DISPUTED" })] }));
  assert.equal(get(disputed, "deal_state")!.status, "fail");
  assert.match(get(disputed, "deal_state")!.message, /only be submitted once/);
  assert.equal(get(evaluateReadiness(base({ deals: [deal({ status: "RESOLVED_FOR_CLIENT" })] })), "deal_state")!.status, "fail");
  const wrongWallet = evaluateReadiness(base({ account: FREELANCER }));
  assert.equal(get(wrongWallet, "wallet_role")!.status, "fail");
  assert.equal(wrongWallet.status, "NOT_READY");
  assert.equal(get(evaluateReadiness(base({ account: CLIENT.toUpperCase().replace("0X", "0x") })), "wallet_role")!.status, "pass");
});

test("freelancer evidence needs DISPUTED, warns on overwrite and on an expired response window", () => {
  const fl = (o: object, extra: Partial<ReadinessInput> = {}) => base({ role: "freelancer", account: FREELANCER, deals: [deal({ status: "DISPUTED", client_evidence_url: "https://a.example/x", dispute_start_time: 100, ...o })], url: "https://b.example/y", ...extra });
  assert.equal(evaluateReadiness(fl({})).status, "READY");
  assert.equal(get(evaluateReadiness(base({ role: "freelancer", account: FREELANCER })), "deal_state")!.status, "fail"); // still FUNDED
  assert.equal(get(evaluateReadiness(fl({ freelancer_evidence_url: "https://old.example/z" })), "overwrite")!.status, "warn");
  const late = evaluateReadiness(fl({}, { timelocks: { now: 100 + 604800, clock_source: "t", dispute_cancel_delay_seconds: 604800, arbitration_recovery_delay_seconds: 259200 } }));
  assert.equal(get(late, "window_expired")!.status, "warn");
  assert.equal(late.canProceed, true);
});

test("resolve_dispute needs DISPUTED + both evidence; callable by any wallet", () => {
  const r = (deals: any, extra: Partial<ReadinessInput> = {}) => evaluateReadiness(base({ action: "resolve_dispute", deals, account: "0x3333333333333333333333333333333333333333", ...extra }));
  const full = deal({ status: "DISPUTED", client_evidence_url: "https://a.example/x", freelancer_evidence_url: "https://b.example/y" });
  assert.equal(r([full]).status, "READY");
  assert.equal(get(r([deal({ status: "DISPUTED", client_evidence_url: "https://a.example/x" })]), "both_evidence")!.status, "fail");
  assert.equal(get(r([deal()]), "deal_state")!.status, "fail");
  assert.equal(get(r([deal({ status: "RESOLVED_FOR_FREELANCER" })]), "deal_state")!.status, "fail");
  assert.equal(get(r([full]), "wallet_role"), undefined); // no role requirement
  const same = deal({ status: "DISPUTED", client_evidence_url: "https://a.example/x", freelancer_evidence_url: "https://a.example/x/" });
  assert.equal(get(r([same]), "url_duplicate")!.status, "warn");
});

test("syntax analysis never claims reachability", () => {
  assert.equal(analyzeEvidenceUrl("https://example.com").kind, "ok");
  const ok = evaluateReadiness(base());
  assert.match(get(ok, "url_format")!.message, /reachability is not verified/);
});

test("the module is pure: no SDK, DOM, network or clock access (no way to send a tx or fetch a URL)", () => {
  const src = readFileSync("src/lib/dispute-readiness.ts", "utf8").replace(/\/\/.*$/gm, "");
  for (const banned of [/genlayer-js/, /\bfetch\s*\(/, /XMLHttpRequest/, /\bwindow\s*\./, /\bdocument\s*\./, /localStorage/, /writeContract|readContract/, /Date\.now|new Date/, /Math\.random/]) {
    assert.doesNotMatch(src, banned, String(banned));
  }
});
