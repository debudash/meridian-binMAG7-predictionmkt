"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { getCluster } from "@/lib/solana/config";
import { getDemoPortfolioSummary } from "@/lib/demo/portfolio";

const NAV = [
  { href: "/markets", label: "Markets" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/history", label: "History" },
];

export function Header() {
  const pathname = usePathname();
  const cluster = getCluster();
  const { connected } = useWallet();
  const redeemable = connected ? getDemoPortfolioSummary().redeemableUsdc : 0;
  const showRedeemDot = redeemable > 0;

  return (
    <>
      <header
        style={{
          borderBottom: "1px solid var(--border)",
          background: "color-mix(in srgb, var(--bg) 92%, transparent)",
          position: "sticky",
          top: 0,
          zIndex: 20,
          backdropFilter: "blur(8px)",
        }}
      >
        <div
          className="container"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "1.25rem",
            minHeight: 56,
          }}
        >
          <Link href="/" style={{ fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em" }}>
            Meridian
          </Link>
          <nav className="desktop-nav" style={{ display: "flex", gap: "0.85rem", flex: 1 }}>
            {NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  style={{
                    color: active ? "var(--text)" : "var(--text-muted)",
                    fontWeight: active ? 600 : 500,
                    textDecoration: "none",
                  }}
                >
                  {item.label}
                  {item.href === "/portfolio" && showRedeemDot && (
                    <span className="nav-dot" title="Redeemable positions" aria-label="Redeemable" />
                  )}
                </Link>
              );
            })}
          </nav>
          <div style={{ flex: 1 }} className="mobile-spacer" />
          <span className="chip" title="Solana cluster">
            {cluster}
          </span>
          <WalletMultiButton style={{ height: 36, fontSize: 13 }} />
        </div>
      </header>
      <nav className="mobile-bottom-nav" aria-label="Primary">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link key={item.href} href={item.href} className={active ? "active" : undefined}>
              {item.label}
              {item.href === "/portfolio" && showRedeemDot && (
                <span className="nav-dot" title="Redeemable" />
              )}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

export function Footer() {
  return (
    <footer
      className="container"
      style={{
        marginTop: "3rem",
        padding: "2rem 0",
        borderTop: "1px solid var(--border)",
        color: "var(--text-muted)",
        fontSize: "0.85rem",
        display: "flex",
        flexWrap: "wrap",
        gap: "1rem",
        justifyContent: "space-between",
      }}
    >
      <div>
        You can lose the full amount you pay for a contract.{" "}
        <Link href="/rules">Rules</Link>
        {" · "}
        <Link href="/terms">Terms</Link>
        {" · "}
        <Link href="/risk">Risk</Link>
      </div>
      <div style={{ fontFamily: "var(--mono)", fontSize: "0.75rem" }}>
        Program · see env NEXT_PUBLIC_MERIDIAN_PROGRAM_ID
      </div>
    </footer>
  );
}
