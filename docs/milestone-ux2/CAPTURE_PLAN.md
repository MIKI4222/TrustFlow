# Screenshots to capture manually

No screenshots are included: the audit environment could not install Tailwind or run `next build`, so a styled render does not exist yet.
Capture these from `npm run dev` or the deployed Netlify site, with a Bradbury wallet. Never mock a successful transaction.

1. `/escrow` dispute card before running the check (button disabled, "Not checked yet").
2. Readiness result **Not ready**: empty claim / malformed URL, with "Action required" rows.
3. Readiness result **Ready with warnings**: e.g. `http://` URL or a PDF link.
4. Readiness result **Ready**, with the "Review before submitting" block.
5. Stale banner after editing a field.
6. Wallet on a wrong network (Not ready, "Correct network").
7. A real transaction on Bradbury (hash shown with Copy + Explorer), only if actually sent.
8. Mobile width (390 px) of the dispute card and the header navigation.
9. `/audit` transaction row with copyable hash.
