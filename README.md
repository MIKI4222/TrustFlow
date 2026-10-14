# TrustFlow B2B

**Automated SLA enforcement and AI arbitration for B2B agreements, built on GenLayer.**

TrustFlow B2B is a web app that connects two deployed GenLayer Intelligent Contracts into one workflow: a service provider's uptime is checked by validators, compensation is paid automatically, and any remaining disagreement is settled by AI consensus instead of a middleman.

> Network: GenLayer **Bradbury Testnet**. The contracts are already deployed and are **not modified** by this repository.

## The trust problem

In B2B contracts the party that benefits usually decides the facts:

- *Did the service really go down?* The provider's status page says no.
- *Was the work really delivered?* The client says no, the contractor says yes, and a paid platform or lawyer arbitrates.

TrustFlow removes the trusted third party. GenLayer validators perform the real-world checks themselves and reach consensus on-chain.

## Contracts

| Contract | Address | Explorer | Source |
|---|---|---|---|
| SLA Guard | `0xF05D822Bd4c2F18b8452ce6086f77070CAdfbE10` | [view](https://explorer-bradbury.genlayer.com/address/0xF05D822Bd4c2F18b8452ce6086f77070CAdfbE10) | [sla-guard-contract](https://github.com/MIKI4222/sla-guard-contract) |
| AI Arbitration Escrow | `0xE6f098D1B49d67390bFec8C8169aeFd99868878f` | [view](https://explorer-bradbury.genlayer.com/address/0xE6f098D1B49d67390bFec8C8169aeFd99868878f) | [ai-arbitration-escrow](https://github.com/MIKI4222/ai-arbitration-escrow) |

- **SLA Guard** — a provider funds an insurance pool and lists covered endpoints. A client with a policy calls `report_outage(url)`; validators fetch the URL themselves (live data), agree on the status code and body through the Equivalence Principle, and the contract pays compensation in the same transaction. Replay protection, cooldowns and incident windows are enforced before any web verdict.
- **AI Arbitration Escrow** — a client opens a deal and deposits the agreed amount, both sides submit an evidence URL and a claim, and `resolve_dispute` makes validators fetch both pages and agree on a winner via comparative AI consensus; the contract then pays the winner. Time-locked recovery paths ensure the deposit is never stuck.

## How the app uses them

```
subscribe ─► Trigger Health Check (report_outage) ─► claim recorded on-chain
                                                        │
                                  "Escalate to AI arbitration"
                                                        ▼
              create_deal ─► submit_*_evidence ─► resolve_dispute ─► AI verdict
                                                        │
                                              /audit (live from chain)
```

| Page | Route | What it does |
|---|---|---|
| Overview | `/` | Live stats from both contracts, wallet connect, quick links |
| SLA Guard Center | `/sla-guard` | Add service / fund (owner), subscribe, **Trigger Health Check**, on-chain claims with escalate button |
| Escrow | `/escrow` | Create a deal with a custodied deposit, submit evidence for either side, `resolve_dispute`, time-locked recovery (`cancel_stalled_dispute`, `resolve_stalled_arbitration`), `release_funds`, filter Active / Disputed / Completed, outcome + raw record |
| Audit | `/audit` | Public live view of claims and deals with verdicts, plus raw transaction log from your browser, explorer links |

### Transaction lifecycle

Write calls are signed with MetaMask / any EVM wallet through `genlayer-js`. The UI then polls the **real** consensus status of the transaction and maps it to: `Broadcasting Transaction` → `Waiting for Consensus` → `Executing AI Reasoning` → `Success / Reverted` (raw network status such as `PROPOSING` or `ACCEPTED` is shown beneath). Raw transactions are stored for audit.

## Custody and value handling

- **SLA Guard holds value.** `deposit_funds` and `subscribe` are payable; `report_outage` pays compensation from the pool. The app attaches the exact premium (`get_premium_amount()`) on `subscribe` and the entered amount on `deposit_funds`.
- **Escrow holds value (v4).** `create_deal(freelancer, description, amount)` is payable and the attached value must **exactly equal** `amount` (wei). The app takes the deposit in GEN, converts it exactly to wei and attaches it. The contract custodies the deposit and pays it out once: to the freelancer on `release_funds`, to the AI-selected winner on `resolve_dispute`, or to the client through a time-locked recovery.
- **Time locks** (read live from `get_timelocks`): `cancel_stalled_dispute` (client, freelancer never answered) opens 7 days after the dispute starts; `resolve_stalled_arbitration` (anyone, both sides submitted but arbitration never completed) opens 3 days after the freelancer's evidence. The UI shows when each becomes available and warns if the consensus clock is unavailable.

## Other limits

- SLA Guard has no uptime-percentage or latency fields; verdicts come from the HTTP status/body seen by validators.
- `add_monitored_service` and `deposit_funds` are owner-only; other wallets can subscribe and report outages. A claim needs an active policy (`subscribe`) and respects cooldown and incident windows (the app checks the free `is_eligible` view first).
- `get_claims_history(limit)` requires its `limit` argument; the app passes 50 (100 on the audit page). Read errors are shown in the UI, never turned into an empty list.
- Escrow roles are enforced by the contract: client and freelancer must be different accounts; only the client opens a dispute and releases, only the freelancer submits counter-evidence.
- Evidence URLs should be static or server-rendered pages; client-side SPAs may not be readable by validators.
- The local transaction log lives in your browser's `localStorage`.

## Tests

```bash
npm test      # tsx --test tests/*.test.ts
```

`tests/mock-chain.ts` models both contracts and rejects any call that does not match the real signatures in `tests/signatures.ts` (unknown method, wrong argument count, view/write mix-up, value on a non-payable method, `create_deal` value different from `amount`). `tests/workflows.test.ts` runs the app's real `src/lib/api.ts` through:

1. **SLA Guard workflow:** add service, deposit, ineligible claim blocked, `subscribe` with the exact premium, `report_outage`, `get_claims_history(limit)`, replay blocked.
2. **Escalation workflow:** claim → pre-filled `create_deal` with attached value exactly equal to the amount → contract custody → both evidence submissions → `resolve_dispute` → verdict and single payout read back; plus the no-dispute `release_funds` path.
3. **Time locks:** `cancel_stalled_dispute` (7 days) and `resolve_stalled_arbitration` (3 days) are refused before the delay and succeed after it; an invalid AI winner reverts with nothing paid.

Further tests check that read errors surface and that every contract method used in `src/` exists in the signature table. The tests use a model derived from the contract sources, not a live chain; CI runs them with the build (`.github/workflows/ci.yml`).

## Getting started

Requirements: Node.js 20+, a wallet with Bradbury testnet GEN.

```bash
git clone https://github.com/MIKI4222/TrustFlow.git
cd TrustFlow
npm install
cp .env.example .env.local
npm run dev        # http://localhost:3000
```

### Environment

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_GENLAYER_RPC_URL` | Optional RPC override. Empty uses the `genlayer-js` Bradbury default |
| `NEXT_PUBLIC_SLA_GUARD_ADDRESS` | SLA Guard contract address |
| `NEXT_PUBLIC_ESCROW_ADDRESS` | Escrow contract address |

## Deploy to Netlify

The app is a static Next.js export (`output: "export"`).

1. Push the repo to GitHub and import it in Netlify.
2. Build command `npm run build`, publish directory `out` (already set in `netlify.toml`).
3. Add the variables from `.env.example` under *Site settings → Environment variables*.

## Tech stack

Next.js 14 (static export), React 18, Tailwind CSS, Lucide icons, `genlayer-js`.

## Project structure

```
src/lib/api.ts            contract-facing logic (reads, writes, value rules), testable without a browser
src/lib/genlayer.ts       genlayer-js client, tx status polling, audit log
tests/                    signature manifest, mock chain, workflow tests
src/components/           Wallet context/button, TxStatus stepper
src/app/                  /, /sla-guard, /escrow, /audit
netlify.toml              build + publish config
SUBMISSION.md             notes for the GenLayer Portal
```

## Roadmap

Per-service SLA policies for API vendors, dispute templates for freelance and agency work, notifications/webhooks, and token custody once a future escrow contract version supports it.

## License

MIT
