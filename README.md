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
| AI Arbitration Escrow | `0xaDC75AeC2155a4d07aBc38B6356B6dfF58f8c6fb` | [view](https://explorer-bradbury.genlayer.com/address/0xaDC75AeC2155a4d07aBc38B6356B6dfF58f8c6fb) | [ai-arbitration-escrow](https://github.com/MIKI4222/ai-arbitration-escrow) |

- **SLA Guard** — a provider funds an insurance pool and lists covered endpoints. A client with a policy calls `report_outage(url)`; validators fetch the URL themselves (live data), agree on the status code and body through the Equivalence Principle, and the contract pays compensation in the same transaction. Replay protection, cooldowns and incident windows are enforced before any web verdict.
- **AI Arbitration Escrow** — a client opens a deal, both sides submit an evidence URL and a claim, and `resolve_dispute` makes validators fetch both pages and agree on a winner via comparative AI consensus.

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
| Escrow | `/escrow` | Create deal, submit evidence for either side, resolve dispute, filter Active / Disputed / Completed, AI verdict + raw record |
| Audit | `/audit` | Public live view of claims and deals with verdicts, plus raw transaction log from your browser, explorer links |

### Transaction lifecycle

Write calls are signed with MetaMask / any EVM wallet through `genlayer-js`. The UI then polls the **real** consensus status of the transaction and maps it to: `Broadcasting Transaction` → `Waiting for Consensus` → `Executing AI Reasoning` → `Success / Reverted` (raw network status such as `PROPOSING` or `ACCEPTED` is shown beneath). Raw transactions are stored for audit.

## Known limits

- SLA Guard has no uptime-percentage or latency fields; verdicts come from the HTTP status/body seen by validators. The UI reflects that.
- `add_monitored_service` and `deposit_funds` are owner-only; other wallets can subscribe and report outages.
- Escrow `amount` is bookkeeping: the deployed contract does not custody tokens.
- Escrow has no list method, so the UI reads `get_deal(0..49)`. Field names are normalized in `src/lib/genlayer.ts` (`normDeal`).
- Evidence URLs should be static or server-rendered pages; client-side SPAs may not be readable by validators.
- The local audit log lives in your browser's `localStorage`.

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
src/lib/genlayer.ts       client, read/write helpers, tx status polling, audit log
src/components/           Wallet context/button, TxStatus stepper
src/app/                  /, /sla-guard, /escrow, /audit
netlify.toml              build + publish config
SUBMISSION.md             notes for the GenLayer Portal
```

## Roadmap

Per-service SLA policies for API vendors, dispute templates for freelance and agency work, notifications/webhooks, and token custody once a future escrow contract version supports it.

## License

MIT
