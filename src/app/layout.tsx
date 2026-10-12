import "./globals.css";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { WalletProvider, WalletButton } from "@/components/Wallet";
export const metadata = { title: "TrustFlow B2B", description: "Automated SLA Guard & AI Arbitration Platform on GenLayer" };
const nav = [["/", "Overview"], ["/sla-guard", "SLA Guard"], ["/escrow", "Escrow"], ["/audit", "Audit"]];
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en"><body><WalletProvider>
      <header className="border-b border-slate-800"><div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 p-4">
        <Link href="/" className="flex items-center gap-2 font-semibold"><ShieldCheck className="text-indigo-400" />TrustFlow B2B</Link>
        <nav className="flex gap-4 text-sm text-slate-400">{nav.map(([h, l]) => <Link key={h} href={h} className="hover:text-white">{l}</Link>)}</nav>
        <WalletButton />
      </div></header>
      <main className="mx-auto max-w-5xl space-y-6 p-4 py-8">{children}</main>
    </WalletProvider></body></html>
  );
}
