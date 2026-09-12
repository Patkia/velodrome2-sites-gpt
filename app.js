import { dashboardMock } from "./data/mock-positions.js";

const positionGrid = document.querySelector("#position-grid");
const emptyState = document.querySelector("#empty-state");
const chainFilter = document.querySelector("#chain-filter");
const cardTemplate = document.querySelector("#position-card-template");

function setText(parent, selector, value) {
    parent.querySelector(selector).textContent = value;
}

function populateChainFilter() {
    [...new Set(dashboardMock.positions.map((position) => position.chain))]
        .forEach((chain) => {
            const option = new Option(chain, chain);
            chainFilter.add(option);
        });
}

function renderSummary() {
    document.querySelector("#wallet-address").textContent = dashboardMock.walletAddress;
    document.querySelector("#last-updated").textContent = `Mock snapshot · ${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(dashboardMock.lastUpdated))}`;

    const inRange = dashboardMock.positions.filter((position) => position.status === "in-range").length;
    const summaryMetrics = document.querySelector("#summary-metrics");
    summaryMetrics.replaceChildren();
    [
        ["Positions", dashboardMock.positions.length],
        ["In range", inRange],
        ["Out of range", dashboardMock.positions.length - inRange]
    ].forEach(([label, value]) => {
        const metric = document.createElement("div");
        const metricLabel = document.createElement("span");
        const metricValue = document.createElement("strong");
        metric.className = "metric";
        metricLabel.textContent = label;
        metricValue.textContent = value;
        metric.append(metricLabel, metricValue);
        summaryMetrics.append(metric);
    });
}

function renderPositions() {
    const selectedChain = chainFilter.value;
    const positions = dashboardMock.positions.filter((position) => selectedChain === "all" || position.chain === selectedChain);
    positionGrid.replaceChildren();
    emptyState.hidden = positions.length !== 0;

    positions.forEach((position) => {
        const card = cardTemplate.content.cloneNode(true);
        const article = card.querySelector("article");
        setText(card, ".chain-name", position.chain);
        setText(card, ".pair-name", position.pair);
        setText(card, ".position-id", `Position #${position.positionId}`);
        const badge = card.querySelector(".status-badge");
        badge.textContent = position.status === "in-range" ? "● In Range" : "● Out of Range";
        badge.classList.add(position.status === "in-range" ? "status-in-range" : "status-out-of-range");
        const tokenList = card.querySelector(".token-list");
        position.tokens.forEach((token) => {
            const row = document.createElement("div");
            const amount = document.createElement("dt");
            const value = document.createElement("dd");
            row.className = "token-row";
            amount.textContent = `${token.amount} ${token.symbol}`;
            value.textContent = token.value;
            row.append(amount, value);
            tokenList.append(row);
        });
        setText(card, ".current-value", position.currentValue);
        setText(card, ".initial-value", position.initialValue);
        const profitLoss = card.querySelector(".profit-loss");
        profitLoss.textContent = position.profitLoss;
        profitLoss.classList.add(position.profitLoss.startsWith("+") ? "positive" : "negative");
        setText(card, ".rewards", position.rewards);
        setText(card, ".card-updated", `Last updated · ${position.lastUpdated}`);
        article.dataset.status = position.status;
        positionGrid.append(card);
    });
}

populateChainFilter();
renderSummary();
renderPositions();
chainFilter.addEventListener("change", renderPositions);
