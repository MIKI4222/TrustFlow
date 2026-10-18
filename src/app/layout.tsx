import "./globals.css";
import Link from "next/link";
import Nav from "@/components/Nav";
import { ShieldCheck } from "lucide-react";
import { WalletProvider, WalletButton } from "@/components/Wallet";
export const metadata = { title: "TrustFlow B2B", description: "Automated SLA Guard & AI Arbitration Platform on GenLayer" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en"><body><WalletProvider>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-slate-800 focus:px-3 focus:py-2">Skip to content</a>
      <header className="border-b border-slate-800"><div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 p-4">
        <Link href="/" className="flex items-center gap-2 font-semibold"><ShieldCheck className="text-indigo-400" />TrustFlow B2B</Link>
        <Nav />
        <WalletButton />
      </div></header>
      <main id="main" className="mx-auto max-w-5xl space-y-6 p-4 py-8">{children}</main>
    </WalletProvider></body></html>
  );
}
