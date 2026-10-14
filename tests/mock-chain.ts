import { SLA_SIG, ESC_SIG, Sig } from "./signatures.ts";

export const SLA_ADDR = "0xF05D822Bd4c2F18b8452ce6086f77070CAdfbE10";
export const ESC_ADDR = "0xE6f098D1B49d67390bFec8C8169aeFd99868878f";
const lc = (s: string) => s.toLowerCase();

// In-memory model of both contracts. It REJECTS any call that does not match the real signatures:
// unknown method, wrong argument count, view/write mixup, or value attached to a non-payable method.
export class MockChain {
  calls: { fn: string; args: any[]; value: bigint; sender: string }[] = [];
  owner = "0xowner";
  fund = 0n; paid = 0n; premium = 10n ** 15n; compensation = 10n ** 16n;
  services: any[] = []; subs: any[] = []; claims: any[] = []; deals: string[] = [];
  endpoints: Record<string, number> = {};
  now = 1_800_000_000; // consensus clock (epoch seconds)
  escrowBalance = 0n; payouts: { to: string; amount: bigint }[] = [];
  arbitrate = (_d: any) => ({ winner: "client", reasoning: "Evidence favors the client." });

  as(sender: string) {
    return {
      read: async (addr: string, fn: string, args: any[] = []) => this.call(addr, fn, args, sender, 0n, "view"),
      write: async (addr: string, fn: string, args: any[], value: bigint = 0n) => this.call(addr, fn, args, sender, value, "write"),
    };
  }

  private call(addr: string, fn: string, args: any[], sender: string, value: bigint, mode: "view" | "write") {
    const table = lc(addr) === lc(SLA_ADDR) ? SLA_SIG : lc(addr) === lc(ESC_ADDR) ? ESC_SIG : null;
    if (!table) throw new Error(`no contract at ${addr}`);
    const sig: Sig | undefined = table[fn];
    if (!sig) throw new Error(`method ${fn} does not exist on contract`);
    if ((mode === "view") !== (sig.kind === "view")) throw new Error(`${fn} is a ${sig.kind} method, called as ${mode}`);
    if (args.length !== sig.argc) throw new Error(`${fn} expects ${sig.argc} argument(s), got ${args.length}`);
    if (value > 0n && sig.kind !== "payable") throw new Error(`${fn} is not payable but value ${value} was attached`);
    this.calls.push({ fn, args, value, sender });
    const h = (lc(addr) === lc(SLA_ADDR) ? this.sla : this.esc)(fn, args, sender.toLowerCase(), value);
    return h;
  }

  private sla = (fn: string, a: any[], who: string, value: bigint): any => {
    const svc = (u: string) => this.services.find((s) => lc(s.url) === lc(u));
    switch (fn) {
      case "get_stats": return JSON.stringify({ total_fund: Number(this.fund), total_paid_out: Number(this.paid), claims_total: this.claims.length });
      case "get_premium_amount": return Number(this.premium);
      case "get_services": return this.services.map((s) => JSON.stringify(s));
      case "get_claims_history": { const n = a[0] <= 0 ? 10 : a[0]; return [...this.claims].reverse().slice(0, n).map((c) => JSON.stringify(c)); }
      case "add_monitored_service": {
        if (who !== this.owner) throw new Error("Only the owner may do this");
        this.services.push({ id: this.services.length, url: a[0], active: true, incident_seq: 0, incident_state: "none", incident_id: "", incident_payouts: 0 }); return this.services.length - 1;
      }
      case "deposit_funds": { if (value <= 0n) throw new Error("Deposit must be greater than zero"); this.fund += value; return null; }
      case "subscribe": {
        if (!svc(a[0])) throw new Error("Service is not insured by this contract");
        if (value < this.premium) throw new Error("Premium payment is too small");
        this.fund += value; this.subs.push({ service_id: svc(a[0]).id, subscriber: who, claimed: false }); return "{}";
      }
      case "is_eligible": {
        const s = svc(a[0]); if (!s) return JSON.stringify({ eligible: false, reason: "URL is not an insured service" });
        const sub = this.subs.find((x) => x.service_id === s.id && x.subscriber === lc(a[1]));
        if (!sub) return JSON.stringify({ eligible: false, reason: "Caller has no policy for this service" });
        if (s.incident_state === "compensated") return JSON.stringify({ eligible: false, reason: "Incident already compensated" });
        return JSON.stringify({ eligible: true, reason: "Claim would be accepted" });
      }
      case "report_outage": {
        const s = svc(a[0]); const sub = s && this.subs.find((x) => x.service_id === s.id && x.subscriber === who);
        if (!sub) throw new Error("Caller has no policy for this service");
        if (s.incident_state === "compensated") throw new Error(`Incident ${s.id}:${s.incident_seq} was already compensated`);
        const code = this.endpoints[a[0]] ?? 200; const approved = code >= 500;
        const incident_id = `${s.id}:${s.incident_seq}`;
        const claim = { id: this.claims.length, claimant: who, service_id: s.id, incident_id, target_url: a[0], status: approved ? "approved" : "rejected", status_code: code, payout: approved ? Number(this.compensation) : 0, reason: approved ? `HTTP ${code} server error` : `HTTP ${code}, endpoint is healthy` };
        if (approved) { this.fund -= this.compensation; this.paid += this.compensation; s.incident_state = "compensated"; s.incident_id = incident_id; s.incident_payouts += 1; }
        this.claims.push(claim); return JSON.stringify({ claim_id: claim.id, approved });
      }
    }
    throw new Error(`mock: ${fn} not modelled`);
  };

  private esc = (fn: string, a: any[], who: string, value: bigint): any => {
    const DAY = 86400, CANCEL = 7 * DAY, RECOVER = 3 * DAY;
    const get = (id: any) => { id = Number(id); if (!(id >= 0 && id < this.deals.length)) throw new Error("Invalid deal ID"); return JSON.parse(this.deals[id]); };
    const put = (id: any, d: any) => { this.deals[Number(id)] = JSON.stringify(d); };
    // _settle: terminal state first, then pay out exactly once from custody
    const settle = (id: any, d: any, status: string, to: string, why: string) => {
      if (d.paid) throw new Error("Deal has already been paid out");
      d.status = status; d.resolution_reasoning = why; d.paid = true; d.resolved_time = this.now; put(id, d);
      const amt = BigInt(d.amount); this.escrowBalance -= amt; this.payouts.push({ to, amount: amt });
    };
    switch (fn) {
      case "get_all_deals": return [...this.deals];
      case "total_deals": return this.deals.length;
      case "get_deal": return (get(a[0]), this.deals[Number(a[0])]);
      case "get_timelocks": return JSON.stringify({ dispute_cancel_delay_seconds: CANCEL, arbitration_recovery_delay_seconds: RECOVER, valid_winners: ["client", "freelancer"], now: this.now, clock_source: "gl.message_raw[datetime]" });
      case "create_deal": {
        const amount = BigInt(a[2]);
        if (!String(a[0]).trim()) throw new Error("Freelancer address cannot be empty");
        if (!String(a[1]).trim()) throw new Error("Description cannot be empty");
        if (amount <= 0n) throw new Error("Amount must be greater than zero");
        if (value !== amount) throw new Error(`Sent value must exactly match the stated deal amount (sent ${value}, stated ${amount})`);
        if (lc(a[0]) === who) throw new Error("Client and freelancer must be different accounts");
        this.escrowBalance += value;
        this.deals.push(JSON.stringify({ id: this.deals.length, client: who, freelancer: lc(a[0]), description: String(a[1]).trim(), amount: Number(amount), status: "FUNDED", client_evidence_url: "", client_claim: "", freelancer_evidence_url: "", freelancer_claim: "", resolution_reasoning: "", created_time: this.now, dispute_start_time: 0, freelancer_evidence_time: 0, resolved_time: 0, paid: false })); return null;
      }
      case "release_funds": { const d = get(a[0]); if (d.status !== "FUNDED") throw new Error("Deal is not in a releasable state"); if (who !== d.client) throw new Error("Only the client can release funds without a dispute"); settle(a[0], d, "RELEASED_TO_FREELANCER", d.freelancer, "Client voluntarily released the deposit to the freelancer."); return null; }
      case "submit_client_evidence": { const d = get(a[0]); if (d.status !== "FUNDED") throw new Error("Deal is not open for evidence"); if (who !== d.client) throw new Error("Only the client can submit client-side evidence"); if (!String(a[1]).trim() || !String(a[2]).trim()) throw new Error("Evidence URL cannot be empty"); Object.assign(d, { client_evidence_url: a[1], client_claim: a[2], status: "DISPUTED", dispute_start_time: this.now }); put(a[0], d); return null; }
      case "submit_freelancer_evidence": { const d = get(a[0]); if (d.status !== "DISPUTED") throw new Error("A dispute must be raised first"); if (who !== d.freelancer) throw new Error("Only the freelancer can submit freelancer-side evidence"); Object.assign(d, { freelancer_evidence_url: a[1], freelancer_claim: a[2], freelancer_evidence_time: this.now }); put(a[0], d); return null; }
      case "resolve_dispute": {
        const d = get(a[0]); if (d.status !== "DISPUTED") throw new Error("Deal is not under dispute"); if (!d.freelancer_evidence_url) throw new Error("Both sides must submit evidence before AI resolution");
        const r = this.arbitrate(d); if (!["client", "freelancer"].includes(r.winner)) throw new Error("Arbitration returned an invalid winner value; resolution rejected");
        settle(a[0], d, r.winner === "freelancer" ? "RESOLVED_FOR_FREELANCER" : "RESOLVED_FOR_CLIENT", r.winner === "freelancer" ? d.freelancer : d.client, r.reasoning); return null;
      }
      case "cancel_stalled_dispute": {
        const d = get(a[0]); if (d.status !== "DISPUTED") throw new Error("Deal is not under dispute"); if (d.freelancer_evidence_url) throw new Error("Freelancer already submitted evidence; use resolve_dispute instead"); if (who !== d.client) throw new Error("Only the client can cancel a stalled dispute");
        const el = this.now - d.dispute_start_time; if (el < CANCEL) throw new Error(`Dispute delay not yet elapsed: ${el}s of ${CANCEL}s have passed`);
        settle(a[0], d, "RESOLVED_FOR_CLIENT", d.client, "Freelancer did not submit counter-evidence within the required 7-day window."); return null;
      }
      case "resolve_stalled_arbitration": {
        const d = get(a[0]); if (d.status !== "DISPUTED") throw new Error("Deal is not under dispute"); if (!d.freelancer_evidence_url) throw new Error("Freelancer has not submitted evidence; use cancel_stalled_dispute instead");
        const el = this.now - d.freelancer_evidence_time; if (el < RECOVER) throw new Error(`Arbitration recovery delay not yet elapsed: ${el}s of ${RECOVER}s have passed`);
        settle(a[0], d, "RESOLVED_FOR_CLIENT", d.client, "AI arbitration could not reach a valid consensus within the recovery window."); return null;
      }
    }
    throw new Error(`mock: ${fn} not modelled`);
  };
}
