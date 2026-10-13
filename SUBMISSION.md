# TrustFlow B2B — submission notes (GenLayer Portal: Projects)

- Source code: https://github.com/MIKI4222/TrustFlow
- Live demo: <!-- add Netlify URL after deploy -->

**What it does.** Frontend platform over two deployed Intelligent Contracts on Bradbury: SLA Guard (`0xF05D822Bd4c2F18b8452ce6086f77070CAdfbE10`) and AI Arbitration Escrow (`0xaDC75AeC2155a4d07aBc38B6356B6dfF58f8c6fb`). Contracts are unchanged.

**Problem.** In B2B, "did the service really fail?" and "was the work really delivered?" are settled by the party that benefits or by a paid intermediary.
- SLA Guard: validators perform the HTTP request themselves (live data) and reach consensus; compensation is paid from the provider's fund in the same transaction.
- Escrow: validators fetch both parties' evidence pages and an LLM consensus (`prompt_comparative`) picks the winner on-chain.

**End-to-end flow.** subscribe → Trigger Health Check (`report_outage`) → claim in on-chain history → "Escalate to AI arbitration" pre-fills an Escrow deal from the claim → submit evidence from both sides → `resolve_dispute` → verdict visible in Audit.

**Transaction lifecycle.** The UI polls the real consensus status of each transaction (PENDING → PROPOSING/COMMITTING/REVEALING → ACCEPTED/FINALIZED, or UNDETERMINED/CANCELED/timeouts) and shows the raw network status. Raw transactions are logged for audit.

**How to use.** `npm install && npm run dev`, connect MetaMask (Bradbury is added automatically), open /sla-guard or /escrow. Owner-only methods (`add_monitored_service`, `deposit_funds`) work only from the contract owner's address.

**Honest limits.** Escrow `amount` is bookkeeping (contract holds no tokens). Deal listing probes `get_deal(0..49)`. Evidence pages should be static/server-rendered. Wallet signing and live runs must be verified by the submitter before publishing.

**Path to continued use.** Per-service SLA policies for API vendors, dispute templates for freelance/agency contracts, webhook/notification layer, and token custody once the escrow contract is upgraded in a future version.
