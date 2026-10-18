"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Same four real routes as before. The active page is marked with aria-current and an underline
// (not color alone). trailingSlash is enabled, so "/escrow/" is normalised before comparing.
const nav: [string, string][] = [["/", "Overview"], ["/sla-guard", "SLA Guard"], ["/escrow", "Escrow"], ["/audit", "Audit"]];
const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

export default function Nav() {
  const path = norm(usePathname() || "/");
  return (
    <nav aria-label="Main" className="order-last flex w-full gap-1 overflow-x-auto text-sm sm:order-none sm:w-auto">
      {nav.map(([href, label]) => {
        const active = norm(href) === path;
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 ${active ? "bg-slate-800 font-medium text-white underline decoration-indigo-400 decoration-2 underline-offset-8" : "text-slate-400 hover:bg-slate-900 hover:text-white"}`}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
