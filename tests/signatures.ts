// Method signatures copied from the contract sources the app targets:
//   sla_guard.py (SLA Guard v4)          https://github.com/MIKI4222/sla-guard-contract
//   arbitration_escrow.py (Escrow v4: create_deal is payable, value must equal amount)
// kind: "view" | "write" | "payable" (payable = @gl.public.write.payable); argc = number of arguments.
export type Sig = { kind: "view" | "write" | "payable"; argc: number };
const v = (argc = 0): Sig => ({ kind: "view", argc });
const w = (argc = 0): Sig => ({ kind: "write", argc });
const p = (argc = 0): Sig => ({ kind: "payable", argc });

export const SLA_SIG: Record<string, Sig> = {
  deposit_funds: p(0), withdraw_funds: w(1), set_compensation_amount: w(1), set_premium_amount: w(1),
  set_incident_window: w(1), set_claim_cooldown: w(1), pause: w(0), unpause: w(0),
  add_monitored_service: w(1), remove_monitored_service: w(1), add_beneficiary: w(2), remove_beneficiary: w(2),
  resolve_incident: w(1), subscribe: p(1), report_outage: w(1),
  get_owner: v(), get_fund_balance: v(), get_compensation_amount: v(), get_premium_amount: v(), get_total_paid_out: v(),
  is_paused: v(), get_claims_count: v(), get_monitored_services: v(), get_services: v(), get_service: v(1),
  get_subscriptions: v(), is_eligible: v(2), get_claim: v(1), get_claims_history: v(1), get_stats: v(),
};
export const ESC_SIG: Record<string, Sig> = {
  create_deal: p(3), release_funds: w(1), submit_client_evidence: w(3), submit_freelancer_evidence: w(3),
  cancel_stalled_dispute: w(1), resolve_stalled_arbitration: w(1), resolve_dispute: w(1),
  get_deal: v(1), get_all_deals: v(), total_deals: v(), get_timelocks: v(),
};
