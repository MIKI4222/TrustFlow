# TrustFlow B2B — submission notes (GenLayer Portal: Projects)

**What it does.** Frontend platform over two deployed Intelligent Contracts on Bradbury: SLA Guard (`0xF05D822Bd4c2F18b8452ce6086f77070CAdfbE10`) and AI Arbitration Escrow (`0xE6f098D1B49d67390bFec8C8169aeFd99868878f`). Contracts are unchanged.

**Problem.** In B2B, "did the service really fail?" and "was the work really delivered?" are settled by the party that benefits or by a paid intermediary.
- SLA Guard: validators perform the HTTP request themselves (live data) and reach consensus; compensation is paid from the provider's fund in the same transaction.
- Escrow: validators fetch both parties' evidence pages and an LLM consensus (`prompt_comparative`) picks the winner on-chain.

**End-to-end flow.** subscribe → Trigger Health Check (`report_outage`) → claim in on-chain history → "Escalate to AI arbitration" pre-fills an Escrow deal from the claim → submit evidence from both sides → `resolve_dispute` → verdict visible in Audit.

**Transaction lifecycle.** The UI polls the real consensus status of each transaction (PENDING → PROPOSING/COMMITTING/REVEALING → ACCEPTED/FINALIZED, or UNDETERMINED/CANCELED/timeouts) and shows the raw network status. Raw transactions are logged for audit.

**How to use.** `npm install && npm run dev`, connect MetaMask (Bradbury is added automatically), open /sla-guard or /escrow. Owner-only methods (`add_monitored_service`, `deposit_funds`) work only from the contract owner's address.

**Custody.** Both contracts hold native tokens. The SLA pool is funded by the provider and premiums and pays outage claims. The escrow (v4) takes a deposit when a deal is created: `create_deal` is payable and the attached value must exactly equal the stated amount. It pays out once, on release, on the AI verdict, or through a time-locked recovery (7 days if the freelancer never answers, 3 days if arbitration cannot complete).

**Tests.** `npm test` runs both workflows (SLA claim; claim escalated to escrow dispute and resolved) through the app's real API layer against a model that enforces the contracts' exact method signatures; see `tests/` and the CI workflow. Evidence pages should be static/server-rendered.

**Path to continued use.** Per-service SLA policies for API vendors, dispute templates for freelance/agency contracts, webhook/notification layer, and token custody once the escrow contract is upgraded in a future version.
