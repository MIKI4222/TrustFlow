# Milestone: TrustFlow UX 2.0 - Dispute Readiness Check

Baseline: see [UX2_BASELINE.md](UX2_BASELINE.md).

## A. Original state
Evidence submission was guarded only by "URL and claim are not empty". The contract is irreversible for client evidence, ignores URL quality, and lets freelancer evidence be overwritten.

## B. What is new
**New functionality: Dispute Readiness Check** (escrow page, both dispute actions).
- Runs a pre-flight check for `submit_client_evidence`, `submit_freelancer_evidence` and `resolve_dispute`.
- Re-reads the deal and time locks from the chain when you press *Run readiness check*, so state is fresh and a failed read is reported as "Not verified", never as a pass.
- Result groups: **Required**, **Recommended**, **Submission prerequisites**. Each row has a status word (Passed / Action required / Warning / Not verified / Note), a source tag (**Contract rule**, **App rule**, **Heuristic**), an explanation, a fix, and a "Go to field" button.
- Overall status `READY`, `READY_WITH_WARNINGS`, `NOT_READY` (and a UI-only `CHECKING`), plus separate lines for *dispute data* and *submission prerequisites*.
- Results go **stale** (greyed, banner, submit disabled) when any input changes: form fields, wallet account, wallet network, or the deal's on-chain state (including after your own successful transaction).
- Review step before submission; an acknowledgement checkbox for irreversible actions (client evidence, `resolve_dispute`).
- Submit is the page's existing handler (`submitEvidence` / `resolveDispute` through `write`). Disabled while a transaction is in flight (prevents duplicate submissions).

**Improvements to existing UI (modest, not a full redesign)**
- Navigation with active-route marker (`aria-current`), horizontal scroll on narrow screens, skip link.
- Design tokens (status colors, focus color), visible keyboard focus, `prefers-reduced-motion`.
- Real `<label>`s on the dispute form; `aria-label`s on the create-deal form; Submit evidence / Resolve dispute segmented control.
- Copy buttons (complete value; "Copied" only after the clipboard write succeeds) and explorer links for client/freelancer addresses and transaction hashes; `rel="noopener noreferrer"` on external links.

**Deferred:** dashboard redesign, SLA Guard page redesign, a dispute stepper across Create deal -> Evidence -> Resolve, `accountsChanged` handling in the wallet provider, styled screenshots.

## C. Technical design
- `src/lib/dispute-readiness.ts`: pure function `evaluateReadiness(input) -> report`. No SDK, DOM, network, clock or randomness (enforced by a test that scans the source).
- `src/components/ReadinessPanel.tsx`: presentation + stale detection (`readinessFingerprint`). Calls back into the page for refresh, field focus and submission.
- `src/app/escrow/page.tsx`: owns form state; `refresh()` re-reads deals/time locks and returns what was read; the existing `run`/`w` write path is unchanged.
- `src/lib/genlayer.ts`: added read-only `EXPECTED_CHAIN_ID` (from the SDK's `testnetBradbury`) and `walletChainId()` (`eth_chainId`). Existing functions untouched.
- Status rule: any `fail` -> `NOT_READY`; else any `warn`, or a `not_verified` in Required/Prerequisite -> `READY_WITH_WARNINGS`; else `READY`. "Evidence page reachable" is `not_verified` in Recommended and does not downgrade a result (otherwise READY could never occur) but is always displayed.

### Rules and their source
| Rule | Level | Source |
|---|---|---|
| Deal ID numeric, deal exists | Required | contract |
| Deal status (`FUNDED` for client, `DISPUTED` for freelancer/resolve), freelancer evidence present for resolve | Required | contract |
| Claim and URL non-empty after trim | Required | contract |
| URL absolute, http(s), no credentials, public host | Required | **app** (contract accepts any non-empty text) |
| Wallet is the deal's client/freelancer | Prerequisite | contract |
| Wallet connected, correct network, contract address configured | Prerequisite | app |
| http instead of https; file/login-prone/hash-route pages; spaces in URL; very short/long claim; same URL as other side | Recommended | app / heuristic |
| Freelancer evidence will be overwritten; response window expired | Recommended | contract-derived |
| Evidence reachable by validators | Recommended | not verifiable from a browser |

## D. Security
- URL handling is **syntax only** (`new URL`). **No request is made to any evidence URL**, so there is no SSRF surface and no CORS workaround. Reachability is always shown as "Not verified".
- Non-http(s) schemes, credentials in URLs and localhost/private/link-local hosts are rejected. Links shown in the review are rendered only for parsed http(s) URLs, with `rel="noopener noreferrer"`.
- The check never signs or sends anything. Transaction success is shown only from the existing receipt polling.
- Nothing new is stored or logged; results live in React state only.

## E. Testing (actually executed, offline sandbox, Node 22)
- `npm test` (`tsx --test tests/*.test.ts`): **28 passed, 0 failed** (7 pre-existing + 21 new in `tests/readiness.test.ts`, covering missing/whitespace fields, malformed URL, unsupported protocols, duplicate URL, missing wallet, wrong network, missing contract config, warnings vs failures, status model, staleness, odd inputs, boundaries, role/state rules for all three actions, module purity).
- Baseline before changes: 7/7 passed.
- Strict `tsc` on `dispute-readiness.ts` + `api.ts`: passed.
- Syntax check (esbuild transform) of every `.ts/.tsx` file: passed.
- **Browser scenario (temporary harness, not committed):** the real `escrow/page.tsx`, `ReadinessPanel`, `Wallet` and `api.ts` bundled with esbuild and driven in headless Chromium (Playwright) against the repo's `MockChain`: 38/38 checks passed, covering disabled-until-checked, stale after every kind of change, wallet/network gating, focus-to-field, single submission with unchanged arguments, duplicate-click protection while pending, freelancer and resolve flows, copy/explorer links, and RPC failure -> "Not verified".
- Contracts: `contracts/*.py` byte-identical to the uploaded archive. No Cloudflare references anywhere.

### NOT verified
- `next build`, ESLint and a full type-check (`@types/react`, `next`, `genlayer-js`, Tailwind could not be installed offline). **Run `npm install && npm test && npm run build` before merging.**
- Anything on the live Bradbury chain or with a real wallet. The browser scenario used a mock chain, not GenLayer.
- Visual design and responsive layout: no styled render was possible (no Tailwind), so desktop/tablet/mobile and contrast were **not** visually checked.
- `EXPECTED_CHAIN_ID` is taken from `genlayer-js`'s `testnetBradbury.id`. It should equal the wallet's chain id after the app's own chain switch; confirm once with a real wallet. If they differ, the check would wrongly block on "Correct network".
- Pre-existing limit: the wallet provider does not listen for `accountsChanged`; after switching accounts in the wallet, click the wallet button again so the app (and the check) use the new account.

## F. Evidence
See [milestone-ux2/CAPTURE_PLAN.md](milestone-ux2/CAPTURE_PLAN.md). No screenshots are included, and none are fabricated.

## G. Changed files
| File | Change |
|---|---|
| `src/lib/dispute-readiness.ts` | new: validation module |
| `tests/readiness.test.ts` | new: 21 tests |
| `src/components/ReadinessPanel.tsx` | new: checklist, stale handling, review, gated submit |
| `src/components/Copy.tsx` | new: `CopyButton`, `AddressChip` |
| `src/components/Nav.tsx` | new: active-route navigation |
| `src/app/escrow/page.tsx` | dispute card rebuilt around the panel; `refresh()`; labels; address chips |
| `src/app/audit/page.tsx` | copyable tx hashes, `rel` on external links |
| `src/app/layout.tsx` | uses `Nav`, skip link, `<main id>` |
| `src/app/globals.css` | tokens, focus, reduced motion, status classes |
| `src/lib/genlayer.ts` | + `EXPECTED_CHAIN_ID`, `walletChainId()` (additive) |
| `docs/*` | this document, baseline, capture plan |

Smart contracts, ABIs/signatures, addresses, `netlify.toml`, env var names and routes are unchanged. Nothing was committed, pushed or deployed.
