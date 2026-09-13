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

  if (Number.isNaN(date.getTime())) {
    return "Snapshot time unavailable";
  }

  return `Fixture snapshot · ${new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)}`;
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

        if (!response.ok) {
          throw new Error("Request failed");
        }

        const payload: unknown = await response.json();

        if (!isPositionsResponse(payload)) {
          throw new Error("Invalid response");
        }

        setLoadState({ status: "ready", data: payload });
      } catch {
        if (!controller.signal.aborted) {
          setLoadState({ status: "error" });
        }
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
  const inRangeCount = data?.positions.filter((position) => position.status === "in-range").length ?? 0;

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Server-backed fixture</p>
          <h1>Velodrome Position Monitor</h1>
          <p className="subtitle">
            A read-only Worker proof of concept. No wallet access, alerts, transactions, storage, or external requests.
          </p>
        </div>
        <span className="poc-badge">POC</span>
      </header>

      {loadState.status === "loading" && (
        <section className="notice-card" aria-live="polite">
          <span className="loading-dot" aria-hidden="true" />
          Loading position data…
        </section>
      )}

      {loadState.status === "error" && (
        <section className="notice-card error-card" role="alert">
          Position data is temporarily unavailable. Please try again later.
        </section>
      )}

      {data && (
        <>
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
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="toolbar" aria-label="Dashboard filters">
            <div>
              <p className="section-label">Staked positions</p>
              <p className="updated">{formatObservedAt(data.generatedAt)}</p>
            </div>
            <label className="filter-label" htmlFor="chain-filter">
              Chain
              <select
                id="chain-filter"
                value={selectedChain}
                onChange={(event) => setSelectedChain(event.target.value)}
              >
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
                    <p className="chain-name">{position.chain}</p>
                    <h2 className="pair-name">{position.pair}</h2>
                    <p className="position-id">Position #{position.positionId}</p>
                  </div>
                  <span className={`status-badge ${position.status === "in-range" ? "status-in-range" : "status-out-of-range"}`}>
                    ● {position.status === "in-range" ? "In Range" : "Out of Range"}
                  </span>
                </div>

                <dl className="token-list">
                  {position.tokens.map((token) => (
                    <div className="token-row" key={token.symbol}>
                      <dt>{token.amount} {token.symbol}</dt>
                      <dd>{token.value}</dd>
                    </div>
                  ))}
                </dl>

                <dl className="value-grid">
                  <div><dt>Current value</dt><dd>{position.currentValue}</dd></div>
                  <div><dt>Initial value</dt><dd>{position.initialValue}</dd></div>
                  <div><dt>Profit / Loss</dt><dd className={position.profitLoss.startsWith("+") ? "positive" : "negative"}>{position.profitLoss}</dd></div>
                  <div><dt>Rewards</dt><dd>{position.rewards}</dd></div>
                </dl>
                <p className="card-updated">Observed · {formatObservedAt(position.observedAt).replace("Fixture snapshot · ", "")}</p>
              </article>
            ))}
          </section>

          {positions.length === 0 && (
            <p className="empty-state">No fixture positions match this chain.</p>
          )}
        </>
      )}
    </main>
  );
}
