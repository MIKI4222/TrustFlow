import { createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";

export const SLA = (process.env.NEXT_PUBLIC_SLA_GUARD_ADDRESS || "0xF05D822Bd4c2F18b8452ce6086f77070CAdfbE10") as `0x${string}`;
export const ESC = (process.env.NEXT_PUBLIC_ESCROW_ADDRESS || "0xE6f098D1B49d67390bFec8C8169aeFd99868878f") as `0x${string}`;
export const EXPLORER = "https://explorer-bradbury.genlayer.com";
const endpoint = process.env.NEXT_PUBLIC_GENLAYER_RPC_URL || undefined;
const cfg = (extra: object = {}) => ({ chain: testnetBradbury, ...(endpoint ? { endpoint } : {}), ...extra });

export type Stage = "idle" | "broadcast" | "consensus" | "reasoning" | "success" | "reverted";
export type AuditEntry = { ts: number; contract: string; fn: string; hash?: string; status: string; raw: string };

const ser = (v: any) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2);
import { parse, normDeal } from "./api";
export { parse, normDeal };

export async function connectWallet(): Promise<string> {
  const eth = (window as any).ethereum;
  if (!eth) throw new Error("MetaMask / EVM wallet not found");
  const [addr] = await eth.request({ method: "eth_requestAccounts" });
  try { await createClient(cfg({ account: addr })).connect("testnetBradbury"); } catch (e) { console.warn("chain switch", e); }
  return addr;
}

export async function read(address: string, fn: string, args: any[] = []) {
  const c = createClient(cfg());
  return parse(await c.readContract({ address: address as `0x${string}`, functionName: fn, args }));
}

export function logAudit(e: AuditEntry) {
  const l: AuditEntry[] = JSON.parse(localStorage.getItem("tf_audit") || "[]");
  localStorage.setItem("tf_audit", JSON.stringify([e, ...l].slice(0, 200)));
}

const OK = ["ACCEPTED", "FINALIZED"];
const FAIL = ["UNDETERMINED", "CANCELED", "LEADER_TIMEOUT", "VALIDATORS_TIMEOUT"];
const stageOf = (n: string): Stage => OK.includes(n) ? "success" : FAIL.includes(n) ? "reverted" : ["PROPOSING", "COMMITTING", "REVEALING"].includes(n) ? "reasoning" : "consensus";

export async function write(address: string, fn: string, args: any[], account: string, onStage: (s: Stage, detail?: string) => void, value = 0n) {
  const name = address.toLowerCase() === SLA.toLowerCase() ? "SLA Guard" : "Escrow";
  const c = createClient(cfg({ account }));
  let hash: string | undefined;
  onStage("broadcast", "Waiting for wallet signature");
  try {
    hash = await c.writeContract({ address: address as `0x${string}`, functionName: fn, args, value });
    // Real lifecycle: poll the actual consensus status of the transaction (no timers/fakes).
    let tx: any, last = "";
    for (let i = 0; i < 240; i++) {
      tx = await c.getTransaction({ hash: hash as any });
      const n = String(tx?.statusName ?? "PENDING");
      if (n !== last) { last = n; onStage(stageOf(n), n); }
      if (OK.includes(n) || FAIL.includes(n)) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    const execErr = /ERROR/i.test(String(tx?.txExecutionResultName ?? tx?.resultName ?? ""));
    const bad = FAIL.includes(last) || execErr || !OK.includes(last);
    onStage(bad ? "reverted" : "success", last + (execErr ? " (execution error)" : ""));
    logAudit({ ts: Date.now(), contract: name, fn, hash, status: bad ? "reverted" : "accepted", raw: ser(tx) });
    if (bad) throw new Error(`Transaction ${last}${execErr ? " with execution error" : ""}`);
    return tx;
  } catch (e: any) {
    onStage("reverted", String(e?.message || e).slice(0, 160));
    if (!hash) logAudit({ ts: Date.now(), contract: name, fn, status: "error", raw: String(e?.message || e) });
    throw e;
  }
}
