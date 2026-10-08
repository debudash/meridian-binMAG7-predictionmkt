"use client";

/**
 * Root providers per docs/ui/07:
 * ConnectionProvider → WalletProvider → QueryClient → ChainClock → TxStatus → optional Pyth
 */
import {
  useMemo,
  useState,
  useEffect,
  useCallback,
  createContext,
  useContext,
  createElement,
  type ReactNode,
  type ComponentType,
  type PropsWithChildren,
} from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getRpcUrl, getCluster } from "@/lib/solana/config";
import { resolveClockNowSec } from "@/lib/market/clock";
import {
  LocalnetDevWalletAdapter,
  isLocalnetDevWalletAllowed,
} from "@/lib/solana/localnetDevWallet";

import "@solana/wallet-adapter-react-ui/styles.css";

/* Wallet-adapter FC types can disagree with @types/react; cast for JSX. */
type ChildrenProps = PropsWithChildren<Record<string, unknown>>;
const Conn = ConnectionProvider as ComponentType<ChildrenProps & { endpoint: string }>;
const Wal = WalletProvider as ComponentType<
  ChildrenProps & { wallets: unknown[]; autoConnect?: boolean }
>;
const WalModal = WalletModalProvider as ComponentType<ChildrenProps>;

/* ---- ChainClock ---- */
interface ChainClockValue {
  nowSec: number;
  skewMs: number;
  refresh: () => void;
}

const ChainClockContext = createContext<ChainClockValue>({
  nowSec: Math.floor(Date.now() / 1000),
  skewMs: 0,
  refresh: () => undefined,
});

export function useChainClock() {
  return useContext(ChainClockContext);
}

function ChainClockProvider({
  children,
  serverNowSec,
}: {
  children?: ReactNode;
  serverNowSec?: number;
}) {
  const [skewMs, setSkewMs] = useState(0);
  const [tick, setTick] = useState(0);
  // Until mounted, report the server's render time so hydration matches SSR (DLV-086).
  const [mounted, setMounted] = useState(false);

  const refresh = useCallback(() => {
    // TODO(schema/rpc): compare getBlockTime vs Date.now(); for now local clock
    setSkewMs(0);
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    setMounted(true);
    refresh();
    const skewTimer = setInterval(refresh, 60_000);
    const tickTimer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      clearInterval(skewTimer);
      clearInterval(tickTimer);
    };
  }, [refresh]);

  const value = useMemo(
    () => ({
      nowSec: resolveClockNowSec({ mounted, serverNowSec, clientNowMs: Date.now(), skewMs }),
      skewMs,
      refresh,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [skewMs, refresh, tick, mounted, serverNowSec],
  );

  return (
    <ChainClockContext.Provider value={value}>{children}</ChainClockContext.Provider>
  );
}

/* ---- TxStatus toast queue ---- */
export type ToastKind = "info" | "success" | "error" | "neutral";
export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}

interface TxStatusValue {
  toasts: Toast[];
  push: (kind: ToastKind, message: string) => void;
  dismiss: (id: string) => void;
}

const TxStatusContext = createContext<TxStatusValue>({
  toasts: [],
  push: () => undefined,
  dismiss: () => undefined,
});

export function useTxStatus() {
  return useContext(TxStatusContext);
}

function TxStatusProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: ToastKind, message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 6000);
  }, []);
  const dismiss = useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  return (
    <TxStatusContext.Provider value={{ toasts, push, dismiss }}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast ${t.kind === "error" ? "toast-error" : ""} ${t.kind === "success" ? "toast-success" : ""}`}
            onClick={() => dismiss(t.id)}
            role="status"
          >
            {t.message}
          </div>
        ))}
      </div>
    </TxStatusContext.Provider>
  );
}

/* ---- Optional Pyth shell ---- */
interface PythValue {
  staleThresholdSec: number;
  getPrice: (symbol: string) => { price?: number; publishTs?: number } | null;
}

const PythContext = createContext<PythValue>({
  staleThresholdSec: 60,
  getPrice: () => null,
});

export function usePyth() {
  return useContext(PythContext);
}

function PythProvider({ children }: { children: ReactNode }) {
  const value = useMemo<PythValue>(
    () => ({
      staleThresholdSec: 60,
      getPrice: () => null,
    }),
    [],
  );
  return <PythContext.Provider value={value}>{children}</PythContext.Provider>;
}

export function AppProviders({
  children,
  serverNowSec,
}: {
  children: ReactNode;
  /** Server render time (unix sec) from the root layout; keeps hydration deterministic. */
  serverNowSec?: number;
}) {
  const endpoint = getRpcUrl();
  // Localnet dev signer is registered ONLY when cluster=localnet + flag + loopback RPC.
  const devWallet = isLocalnetDevWalletAllowed();
  const wallets = useMemo(
    () => [
      ...(devWallet ? [new LocalnetDevWalletAdapter()] : []),
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
    ],
    [devWallet],
  );
  const [queryClient] = useState(() => new QueryClient());

  return createElement(
    Conn,
    { endpoint },
    createElement(
      Wal,
      { wallets, autoConnect: devWallet },
      createElement(
        WalModal,
        null,
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(
            ChainClockProvider,
            { serverNowSec },
            createElement(
              TxStatusProvider,
              null,
              createElement(
                PythProvider,
                null,
                createElement("span", { "data-cluster": getCluster(), hidden: true }),
                children,
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
