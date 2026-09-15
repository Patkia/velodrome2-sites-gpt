"use client";

import { useEffect, useMemo, useState } from "react";
import {
  filterPositions,
  isPositionsResponse,
  type PositionsResponse,
} from "@/lib/shared/positions-schema";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: PositionsResponse }
  | { status: "error" };

function formatObservedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Updated time unavailable";
  return `Updated · ${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date)}`;
}

function shortAddress(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

function tokenLabel(symbol: string | null, address: string): string {
  return symbol ?? shortAddress(address);
}

function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Unavailable";
  return `~${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
}

function tokenAmount(value: string | null | undefined): string {
  if (!value) return "Unavailable";
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? new Intl.NumberFormat("en-US", { maximumFractionDigits: numeric >= 1 ? 4 : 8 }).format(numeric)
    : value;
}

export default function Home() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [selectedChain, setSelectedChain] = useState("all");

  useEffect(() => {
    const controller = new AbortController();

    async function loadPositions() {
      try {
        const response = await fetch("/api/positions", {
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Request failed");
        const payload: unknown = await response.json();
        if (!isPositionsResponse(payload)) throw new Error("Invalid response");
        setLoadState({ status: "ready", data: payload });
      } catch {
        if (!controller.signal.aborted) setLoadState({ status: "error" });
      }
    }

    void loadPositions();
    return () => controller.abort();
  }, []);

  const data = loadState.status === "ready" ? loadState.data : null;
  const chains = useMemo(
    () => [...new Set((data?.positions ?? []).map((position) => position.chain))],
    [data],
  );
  const positions = useMemo(
    () => filterPositions(data?.positions ?? [], selectedChain),
    [data, selectedChain],
  );
  const inRangeCount = data?.positions.filter((position) => position.inRange).length ?? 0;

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Live blockchain data</p>
          <h1>Velodrome Position Monitor</h1>
          <p className="subtitle">Read-only active liquidity positions across Optimism, Celo, and Soneium.</p>
        </div>
      </header>

      {loadState.status === "loading" && (
        <section className="notice-card" aria-live="polite">
          <span className="loading-dot" aria-hidden="true" /> Loading position data…
        </section>
      )}

      {loadState.status === "error" && (
        <section className="notice-card error-card" role="alert">
          Position data is temporarily unavailable. Please try again later.
        </section>
      )}

      {data && (
        <>
          {data.status === "partial" && (
            <section className="notice-card error-card" role="status">
              Some chains could not be read. Showing available live positions only.
            </section>
          )}

          <section className="summary-card" aria-labelledby="wallet-summary-title">
            <div>
              <p className="section-label" id="wallet-summary-title">Wallet summary</p>
              <p className="wallet-address">{data.walletAddress}</p>
            </div>
            <div className="summary-metrics" aria-live="polite">
              {[
                ["Positions", data.positions.length],
                ["In range", inRangeCount],
                ["Out of range", data.positions.length - inRangeCount],
              ].map(([label, value]) => (
                <div className="metric" key={label}>
                  <span>{label}</span><strong>{value}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="toolbar" aria-label="Dashboard filters">
            <div>
              <p className="section-label">Active positions</p>
              <p className="updated">{formatObservedAt(data.generatedAt)}</p>
            </div>
            <label className="filter-label" htmlFor="chain-filter">
              Chain
              <select id="chain-filter" value={selectedChain} onChange={(event) => setSelectedChain(event.target.value)}>
                <option value="all">All chains</option>
                {chains.map((chain) => <option key={chain} value={chain}>{chain}</option>)}
              </select>
            </label>
          </section>

          <section className="position-grid" aria-live="polite">
            {positions.map((position) => (
              <article className="position-card" data-status={position.status} key={`${position.chain}-${position.positionId}`}>
                <div className="card-heading">
                  <div>
                    <p className="chain-name">{position.chain} · Chain {position.chainId}</p>
                    <h2 className="pair-name">{tokenLabel(position.token0Symbol, position.token0)} / {tokenLabel(position.token1Symbol, position.token1)}</h2>
                    <p className="position-id">Position #{position.positionId} · {position.source}</p>
                  </div>
                  <span className={`status-badge ${position.inRange ? "status-in-range" : "status-out-of-range"}`}>
                    ● {position.inRange ? "In Range" : "Out of Range"}
                  </span>
                </div>

                <dl className="value-grid">
                  <div className="current-value"><dt>Current Value</dt><dd>{formatUsd(position.currentValueUsd)}</dd></div>
                  <div><dt>Initial Value</dt><dd>{formatUsd(position.initialValueUsd)}</dd></div>
                  <div><dt>P/L</dt><dd>{formatUsd(position.pnlUsd)}</dd></div>
                </dl>

                <dl className="asset-list">
                  {[
                    { label: position.token0Symbol ?? "Token 0", address: position.token0, amount: position.token0Amount, value: position.token0ValueUsd },
                    { label: position.token1Symbol ?? "Token 1", address: position.token1, amount: position.token1Amount, value: position.token1ValueUsd },
                  ].map((token) => (
                    <div className="asset-row" key={token.address}>
                      <dt><strong>{token.label}</strong><span>{shortAddress(token.address)}</span></dt>
                      <dd>{tokenAmount(token.amount)} <span>({formatUsd(token.value)})</span></dd>
                    </div>
                  ))}
                  <div className="asset-row reward-row">
                    <dt><strong>Reward {position.rewardSymbol ?? ""}</strong><span>Earned</span></dt>
                    <dd>{tokenAmount(position.rewardAmount)} <span>({formatUsd(position.rewardValueUsd)})</span></dd>
                  </div>
                </dl>
              </article>
            ))}
          </section>

          {positions.length === 0 && <p className="empty-state">No active positions found.</p>}
        </>
      )}
    </main>
  );
}
