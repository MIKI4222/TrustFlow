# TrustFlow

Automated SLA enforcement and AI arbitration for B2B agreements on GenLayer: validators check live service uptime and pay compensation, and escalate disputes to AI-consensus arbitration. No middleman.

---

## Features

### Dispute Readiness Check (UX 2.0)
The Escrow page includes a pre-flight readiness checker for client evidence submission, freelancer evidence submission, and dispute resolution. It refreshes the relevant deal state and time locks from the chain, then checks contract requirements, application-level rules, wallet connection, network prerequisites, and evidence URL quality.

Each result is classified as a contract rule, application rule, or heuristic. The checker sends no transaction and does not fetch evidence URLs, so it cannot guarantee that validators will successfully read the evidence or predict the arbitration outcome. Results become stale when relevant inputs, wallet state, or on-chain data change. Irreversible actions require explicit acknowledgement.

UX 2.0 also improves keyboard accessibility, navigation feedback, form labels, reduced-motion support, and copying addresses and transaction hashes with explorer links.

See the UX 2.0 milestone report (`docs/MILESTONE_UX2.md`) for implementation details, test results, and limitations.

---

## Live Application & Contracts
- **Live App**: [https://trustflowapp.netlify.app/](https://trustflowapp.netlify.app/)
- **Contracts**:
  - `ArbitrationEscrow`: Implemented in Python for GenLayer.
  - `SLAGuard`: Automated service uptime monitoring and compensation logic.
