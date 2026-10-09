"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import dynamic from "next/dynamic";

// Client-only: the button renders the remembered wallet's icon from localStorage,
// which the server can't know — SSR caused a hydration mismatch once a wallet was picked.
const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  {
    ssr: false,
    loading: () => (
      <span className="chip" style={{ height: 36, padding: "0 0.9rem" }}>
        Wallet…
      </span>
    ),
  },
);
import { explorerAddress, getCluster, getProgramId } from "@/lib/solana/config";
import { isNavActive } from "@/lib/ui/selection";
import { usePortfolio } from "@/hooks/usePortfolio";
import { POLL_MS } from "@/lib/rpc/pollPolicy";
import { useChainClock } from "@/components/providers/AppProviders";
import { ChangeWalletButton } from "@/components/wallet/ChangeWalletButton";

const NAV = [
  { href: "/markets", label: "Markets" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/history", label: "History" },
];

export function Header() {
  const pathname = usePathname();
  const cluster = getCluster();
  const { connected } = useWallet();
  const { nowSec } = useChainClock();
  // Real winning-side balances on settled markets (demo only in localnet fixture mode) — DLV-088.
  // M4: settled markets' Yes/No ATAs only (no Phoenix market-state reads), every 60s.
  const { portfolio } = usePortfolio(nowSec, POLL_MS.headerAccount, "redeemable");
  const redeemable = connected ? portfolio?.totals.redeemableUsdc ?? 0 : 0;
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
          className="container header-row"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "1.25rem",
            minHeight: 56,
          }}
        >
          <Link
            href="/"
            className="brand-link"
            aria-current={isNavActive(pathname, "/") ? "page" : undefined}
            style={{ fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em" }}
          >
            Meridian
          </Link>
          <nav
            className="desktop-nav"
            aria-label="Primary"
            style={{ display: "flex", gap: "0.35rem", flex: 1 }}
          >
            {NAV.map((item) => {
              const active = isNavActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="nav-link"
                  aria-current={active ? "page" : undefined}
                >
                  {item.label}
                  {item.href === "/portfolio" && showRedeemDot && (
                    <span
                      className="nav-dot"
                      title={`Redeemable: ${redeemable.toFixed(2)} USDC`}
                      aria-label="Redeemable"
                    />
                  )}
                </Link>
              );
            })}
          </nav>
          <div style={{ flex: 1 }} className="mobile-spacer" />
          <span className="chip" title="Solana cluster">
            {cluster}
          </span>
          {/* DLV-115: always reachable, even with a stale remembered wallet (e.g. Phantom not installed). */}
          <ChangeWalletButton />
          <WalletMultiButton style={{ height: 36, fontSize: 13, padding: "0 0.9rem", whiteSpace: "nowrap" }} />
        </div>
      </header>
      <nav className="mobile-bottom-nav" aria-label="Primary (mobile)">
        {NAV.map((item) => {
          const active = isNavActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={active ? "active" : undefined}
              aria-current={active ? "page" : undefined}
            >
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
        {" · "}
        <Link href="/status">Status</Link>
      </div>
      <FooterProgramId />
    </footer>
  );
}

/** The deployed program id (NEXT_PUBLIC_MERIDIAN_PROGRAM_ID, inlined at build), linked to the explorer. */
function FooterProgramId() {
  const id = getProgramId().toBase58();
  return (
    <div style={{ fontFamily: "var(--mono)", fontSize: "0.75rem" }}>
      Program{" "}
      <a href={explorerAddress(id)} target="_blank" rel="noreferrer" title={id} data-testid="footer-program-id">
        {id.slice(0, 4)}…{id.slice(-5)}
      </a>
    </div>
  );
}
