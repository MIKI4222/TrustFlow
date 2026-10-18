# UX 2.0 baseline (state before this upgrade)

Audit of the uploaded `TrustFlow-main.zip` (files dated 2026-10-14). Not a git checkout, so branch/commit history was not available.
"Verified" means verified in the audit environment (no wallet, no network access); anything needing a live chain is listed as such.

## Architecture
Next.js 14 static export (`output: "export"`, `trailingSlash`), React 18, Tailwind 3, `lucide-react`, `genlayer-js`. Netlify publishes `out/` (`netlify.toml`). CI (`.github/workflows/ci.yml`): `npm install`, `npm test`, `npm run build`.
Contract-facing logic is in `src/lib/api.ts` (pure, no SDK) and `src/lib/genlayer.ts` (client, wallet, tx polling, localStorage audit log).

## Routes
| Route | Purpose |
|---|---|
| `/` | Overview: stats from both contracts |
| `/sla-guard` | Subscribe, trigger health check, claims, escalate to escrow |
| `/escrow` | Create deal, submit evidence, resolve dispute, release, stalled-dispute recovery |
| `/audit` | Live claims/deals plus local transaction log |

## Escrow dispute workflow (read from `contracts/arbitration_escrow.py`)
| Action | Contract rules (asserts) |
|---|---|
| `submit_client_evidence(id, url, claim)` | deal `FUNDED`; sender is the deal's client; `url.strip()` and `claim.strip()` non-empty. Moves the deal to `DISPUTED`; cannot be repeated. |
| `submit_freelancer_evidence(id, url, claim)` | deal `DISPUTED`; sender is the freelancer; url and claim non-empty. **Does not check for earlier freelancer evidence: a second call overwrites it.** |
| `resolve_dispute(id)` | deal `DISPUTED` and freelancer evidence present. Any caller. Validators render both URLs as text and read only the first 6000 characters of each. |

The contract does **not** validate URL format, protocol, length, or reachability. Before this upgrade the UI only checked "non-empty" (`submitEvidence` in `api.ts`). No readiness/validation feature existed.

## Feature status (before changes)
| Feature | Status |
|---|---|
| Unit/workflow tests (`npm test`) | Verified working: 7/7 pass |
| Contract source in repo, method signatures mirrored in `tests/signatures.ts` | Verified present |
| Wallet connect, chain switch (`connectWallet`) | Present, requires live verification. Chain-switch failure is only `console.warn`ed. |
| Account change handling | Incomplete: no `accountsChanged` listener (account is read once at connect) |
| Escrow create / evidence / resolve / release / recovery flows | Present, requires live verification |
| SLA Guard flows | Present, requires live verification |
| Audit page | Present, requires live verification |
| Transaction lifecycle (polled real consensus status) | Present, requires live verification |
| Responsive behavior | Not verified (Tailwind classes only; no build/browser run) |
| Input validation before evidence submission | Incomplete (non-empty only) |
| Field labels / keyboard focus | Incomplete (placeholder-only inputs; `outline-none` on inputs) |
| `next build`, lint, type-check | Not run in the audit environment (dependencies not installable offline). `tsconfig` has `strict: false`. |

## Known issues found
1. Client evidence is irreversible, and a mistyped or unreadable URL is accepted by the contract and silently weakens the case at resolution time.
2. Freelancer evidence can be overwritten without warning.
3. Wallet account changes are not tracked; a wrong-network wallet is only logged to the console.
4. Placeholder-only form fields, no visible focus on inputs, no active-route indication in navigation, external links without `rel`.
