import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { MockChain, SLA_ADDR, ESC_ADDR } from "./mock-chain.ts";
import { SLA_SIG, ESC_SIG } from "./signatures.ts";
import * as api from "../src/lib/api.ts";

const OWNER = "0xOwner", CLIENT = "0xClient", FREELANCER = "0xFreelancer";
const mk = () => { const c = new MockChain(); c.owner = OWNER.toLowerCase(); c.endpoints["https://httpbin.org/status/500"] = 500; c.endpoints["https://httpbin.org/status/200"] = 200; return c; };
const URL500 = "https://httpbin.org/status/500";

test("Workflow 1 — SLA Guard: fund, subscribe, health check, claim history (limit passed)", async () => {
  const c = mk(), owner = c.as(OWNER), client = c.as(CLIENT);
  await api.addService(owner.write, SLA_ADDR, URL500);
  await api.addService(owner.write, SLA_ADDR, "https://httpbin.org/status/200");
  await api.depositFunds(owner.write, SLA_ADDR, 10n ** 18n);

  // a client without a policy is stopped by the free is_eligible view, no transaction is sent
  await assert.rejects(api.reportOutage(client.read, client.write, SLA_ADDR, URL500, CLIENT), /no policy/);
  assert.equal(c.calls.filter((x) => x.fn === "report_outage").length, 0);

  await api.subscribe(client.read, client.write, SLA_ADDR, URL500); // value == get_premium_amount()
  assert.equal(c.calls.at(-1)!.value, c.premium);
  await api.reportOutage(client.read, client.write, SLA_ADDR, URL500, CLIENT);

  const claims = await api.getClaims(client.read, SLA_ADDR);
  assert.equal(claims.length, 1);
  assert.equal(claims[0].status, "approved");
  assert.equal(claims[0].status_code, 500);
  assert.deepEqual(c.calls.filter((x) => x.fn === "get_claims_history").at(-1)!.args, [api.CLAIMS_LIMIT]); // limit passed

  const stats = await api.getStats(client.read, SLA_ADDR);
  assert.equal(stats.total_paid_out, Number(c.compensation));
  const services = await api.getServices(client.read, SLA_ADDR);
  assert.equal(services[0].url, URL500); // parsed objects, not raw JSON strings
  assert.equal(services[0].incident_state, "compensated");

  // replay of the same incident is refused before sending a transaction
  await assert.rejects(api.reportOutage(client.read, client.write, SLA_ADDR, URL500, CLIENT), /already compensated/);
});

const AMT = api.toWei("0.05"); // 50000000000000000n

test("Workflow 2 — SLA claim escalated to a custodied Escrow dispute, resolved by AI verdict", async () => {
  const c = mk(), owner = c.as(OWNER), client = c.as(CLIENT), freelancer = c.as(FREELANCER);
  await api.addService(owner.write, SLA_ADDR, URL500);
  await api.depositFunds(owner.write, SLA_ADDR, 10n ** 18n);
  await api.subscribe(client.read, client.write, SLA_ADDR, URL500);
  await api.reportOutage(client.read, client.write, SLA_ADDR, URL500, CLIENT);
  const [claim] = await api.getClaims(client.read, SLA_ADDR);

  const esc = api.escalationFromClaim(claim);
  assert.match(esc.description, /claim #0/);
  await api.createDeal(client.write, ESC_ADDR, { freelancer: FREELANCER, description: esc.description, amountWei: AMT }, CLIENT);
  const create = c.calls.find((x) => x.fn === "create_deal")!;
  assert.equal(create.value, AMT);              // attached value EXACTLY equals the stated amount
  assert.equal(create.args[2], AMT);
  assert.equal(c.escrowBalance, AMT);           // contract now custodies the deposit

  await api.submitEvidence(client.write, ESC_ADDR, "client", 0, "https://example.com/client", esc.claim);
  await api.submitEvidence(freelancer.write, ESC_ADDR, "freelancer", 0, "https://example.com/freelancer", "Service restored.");
  c.arbitrate = () => ({ winner: "freelancer", reasoning: "Outage was resolved within the window." });
  await api.resolveDispute(client.write, ESC_ADDR, 0);

  const deals = await api.getDeals(client.read, ESC_ADDR);
  assert.equal(deals[0].status, "RESOLVED_FOR_FREELANCER");
  assert.equal(deals[0].paid, true);
  assert.equal(api.dealKind(deals[0]), "Completed");
  assert.equal(api.winnerOf(deals[0]), "freelancer");
  assert.match(deals[0].reasoning, /resolved within the window/);
  assert.deepEqual(c.payouts, [{ to: FREELANCER.toLowerCase(), amount: AMT }]); // paid out once, to the winner
  assert.equal(c.escrowBalance, 0n);

  // no-dispute path: release_funds pays the freelancer from custody
  await api.createDeal(client.write, ESC_ADDR, { freelancer: FREELANCER, description: "Landing page", amountWei: 5n }, CLIENT);
  await api.releaseFunds(client.write, ESC_ADDR, 1);
  assert.equal((await api.getDeals(client.read, ESC_ADDR))[1].status, "RELEASED_TO_FREELANCER");
  assert.deepEqual(c.payouts.at(-1), { to: FREELANCER.toLowerCase(), amount: 5n });
  await assert.rejects(api.releaseFunds(client.write, ESC_ADDR, 1), /not in a releasable state/); // no double payout
});

test("Escrow time locks: stalled recovery opens only after the contract delays", async () => {
  const c = mk(), client = c.as(CLIENT), freelancer = c.as(FREELANCER);
  const mkDisputed = async (withFreelancer: boolean) => {
    await api.createDeal(client.write, ESC_ADDR, { freelancer: FREELANCER, description: "Job", amountWei: AMT }, CLIENT);
    const id = c.deals.length - 1;
    await api.submitEvidence(client.write, ESC_ADDR, "client", id, "https://e.com/c", "Not delivered");
    if (withFreelancer) await api.submitEvidence(freelancer.write, ESC_ADDR, "freelancer", id, "https://e.com/f", "Delivered");
    return id;
  };
  // freelancer never answers -> cancel_stalled_dispute after 7 days
  const a = await mkDisputed(false);
  const tl0 = await api.getTimelocks(client.read, ESC_ADDR);
  assert.equal(api.stalledInfo((await api.getDeals(client.read, ESC_ADDR))[a], tl0)!.fn, "cancel_stalled_dispute");
  assert.equal(api.stalledInfo((await api.getDeals(client.read, ESC_ADDR))[a], tl0)!.ready, false);
  await assert.rejects(api.cancelStalledDispute(client.write, ESC_ADDR, a), /delay not yet elapsed/);
  c.now += 7 * 86400;
  const tl1 = await api.getTimelocks(client.read, ESC_ADDR);
  assert.equal(api.stalledInfo((await api.getDeals(client.read, ESC_ADDR))[a], tl1)!.ready, true);
  await api.cancelStalledDispute(client.write, ESC_ADDR, a);
  assert.equal((await api.getDeals(client.read, ESC_ADDR))[a].status, "RESOLVED_FOR_CLIENT");

  // both submitted but arbitration never completes -> resolve_stalled_arbitration after 3 days (anyone)
  const b = await mkDisputed(true);
  c.arbitrate = () => ({ winner: "unresolved", reasoning: "" });
  await assert.rejects(api.resolveDispute(client.write, ESC_ADDR, b), /invalid winner/);
  assert.equal((await api.getDeals(client.read, ESC_ADDR))[b].status, "DISPUTED"); // nothing paid
  await assert.rejects(api.resolveStalledArbitration(c.as("0xAnyone").write, ESC_ADDR, b), /delay not yet elapsed/);
  c.now += 3 * 86400;
  await api.resolveStalledArbitration(c.as("0xAnyone").write, ESC_ADDR, b);
  assert.equal((await api.getDeals(client.read, ESC_ADDR))[b].status, "RESOLVED_FOR_CLIENT");
  assert.equal(c.escrowBalance, 0n);
});

test("GEN amounts convert exactly to wei", () => {
  assert.equal(api.toWei("1"), 10n ** 18n);
  assert.equal(api.toWei("0.05"), 50000000000000000n);
  assert.equal(api.toWei("0.000000000000000001"), 1n);
  assert.throws(() => api.toWei("abc"), /positive amount/);
  assert.throws(() => api.toWei("-1"), /positive amount/);
  assert.equal(api.formatGen("980000000000000000"), "0.98 GEN");
});

test("the mock enforces real signatures (the old bugs would fail here)", async () => {
  const c = mk(), r = c.as(CLIENT);
  await assert.rejects(r.read(SLA_ADDR, "get_claims_history", []), /expects 1 argument/);        // missing limit
  await assert.rejects(r.write(ESC_ADDR, "create_deal", ["0xF", "d", 5n], 4n), /exactly match/);     // value must equal amount
  await assert.rejects(r.write(ESC_ADDR, "create_deal", ["0xF", "d", 5n], 0n), /exactly match/);     // value missing
  await assert.rejects(r.write(ESC_ADDR, "release_funds", [0], 1n), /not payable/);                    // value on non-payable
  await assert.rejects(r.read(ESC_ADDR, "get_deal", [0]), /Invalid deal ID/);
  await assert.rejects(async () => api.createDeal(r.write, ESC_ADDR, { freelancer: CLIENT, description: "x", amountWei: 5n }, CLIENT), /different accounts/);
  await assert.rejects(r.read(SLA_ADDR, "get_stat", []), /does not exist/);
});

test("read errors surface instead of becoming an empty history", async () => {
  const broken: api.Reader = async () => { throw new Error("RPC unavailable"); };
  await assert.rejects(api.getClaims(broken, SLA_ADDR), /RPC unavailable/);
  await assert.rejects(api.getDeals(broken, ESC_ADDR), /RPC unavailable/);
  const notList: api.Reader = async () => "not-json-list";
  await assert.rejects(api.getClaims(notList, SLA_ADDR), /expected a list/);
});

test("every contract method called from src/ exists in the contract signatures", () => {
  const files: string[] = [];
  const walk = (d: string) => readdirSync(d).forEach((f) => { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) && files.push(p); });
  walk("src");
  const known = new Set([...Object.keys(SLA_SIG), ...Object.keys(ESC_SIG)]);
  const used = new Set<string>();
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/(?:read|write)\(\s*(?:SLA|ESC|sla|esc|a)\s*,\s*"([a-z_]+)"/g)) used.add(m[1]);
  }
  assert.ok(used.size >= 12, `expected many calls, found ${used.size}`);
  for (const fn of used) assert.ok(known.has(fn), `${fn} is not a method of the deployed contracts`);
});
