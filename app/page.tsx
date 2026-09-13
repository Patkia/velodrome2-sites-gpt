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
        <span className="poc-badge">POC</span>
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

                <dl className="token-list">
                  <div className="token-row"><dt>{position.token0Symbol ?? "Token 0"}</dt><dd>{shortAddress(position.token0)}</dd></div>
                  <div className="token-row"><dt>{position.token1Symbol ?? "Token 1"}</dt><dd>{shortAddress(position.token1)}</dd></div>
                </dl>

                <dl className="value-grid">
                  <div><dt>Liquidity</dt><dd>{position.liquidity}</dd></div>
                  <div><dt>Current tick</dt><dd>{position.currentTick}</dd></div>
                  <div><dt>Tick range</dt><dd>{position.tickLower} → {position.tickUpper}</dd></div>
                  <div><dt>Value / P&amp;L</dt><dd>—</dd></div>
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
