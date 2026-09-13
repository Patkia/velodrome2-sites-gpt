export type PositionStatus = "in-range" | "out-of-range";

export interface PositionToken {
  symbol: string;
  amount: string;
  value: string;
  valueUsd: number | null;
}

export interface DashboardPosition {
  chain: string;
  positionId: number;
  pair: string;
  status: PositionStatus;
  inRange: boolean;
  tokens: PositionToken[];
  currentValue: string;
  currentValueUsd: number | null;
  initialValue: string;
  initialValueUsd: number | null;
  profitLoss: string;
  profitLossUsd: number | null;
  profitLossPercent: number | null;
  rewards: string;
  observedAt: string;
}

export interface PositionsResponse {
  schemaVersion: 1;
  status: "ok";
  generatedAt: string;
  walletAddress: string;
  positionsChecked: number;
  positions: DashboardPosition[];
  unavailableChains: string[];
}

export const POSITIONS_FIXTURE: PositionsResponse = {
  schemaVersion: 1,
  status: "ok",
  generatedAt: "2026-09-12T03:30:00Z",
  walletAddress: "0x7a9F...A32c",
  positionsChecked: 3,
  positions: [
    {
      chain: "Optimism", positionId: 10482, pair: "WETH / OP", status: "in-range", inRange: true,
      tokens: [
        { symbol: "WETH", amount: "1.2458", value: "$5,179.58", valueUsd: 5179.58 },
        { symbol: "OP", amount: "2,914.28", value: "$4,371.42", valueUsd: 4371.42 },
      ],
      currentValue: "$9,551.00", currentValueUsd: 9551,
      initialValue: "$8,940.00", initialValueUsd: 8940,
      profitLoss: "+$611.00 (+6.83%)", profitLossUsd: 611, profitLossPercent: 6.83,
      rewards: "82.41 VELO · $9.07", observedAt: "2026-09-12T03:28:00Z",
    },
    {
      chain: "Celo", positionId: 66480, pair: "CELO / USDC", status: "out-of-range", inRange: false,
      tokens: [
        { symbol: "CELO", amount: "4,625.70", value: "$2,775.42", valueUsd: 2775.42 },
        { symbol: "USDC", amount: "5,918.60", value: "$5,918.60", valueUsd: 5918.6 },
      ],
      currentValue: "$8,694.02", currentValueUsd: 8694.02,
      initialValue: "$9,280.00", initialValueUsd: 9280,
      profitLoss: "-$585.98 (-6.31%)", profitLossUsd: -585.98, profitLossPercent: -6.31,
      rewards: "126.55 VELO · $13.92", observedAt: "2026-09-12T03:28:00Z",
    },
    {
      chain: "Soneium", positionId: 73211, pair: "ASTR / WETH", status: "in-range", inRange: true,
      tokens: [
        { symbol: "ASTR", amount: "35,800.00", value: "$1,718.40", valueUsd: 1718.4 },
        { symbol: "WETH", amount: "0.5312", value: "$2,208.27", valueUsd: 2208.27 },
      ],
      currentValue: "$3,926.67", currentValueUsd: 3926.67,
      initialValue: "$3,740.00", initialValueUsd: 3740,
      profitLoss: "+$186.67 (+4.99%)", profitLossUsd: 186.67, profitLossPercent: 4.99,
      rewards: "48.10 ASTR · $2.31", observedAt: "2026-09-12T03:27:00Z",
    },
  ],
  unavailableChains: [],
};

export function filterPositions(positions: DashboardPosition[], chain: string): DashboardPosition[] {
  return chain === "all" ? positions : positions.filter((position) => position.chain === chain);
}

export function isPositionsResponse(value: unknown): value is PositionsResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<PositionsResponse>;

  return candidate.schemaVersion === 1
    && candidate.status === "ok"
    && typeof candidate.generatedAt === "string"
    && typeof candidate.walletAddress === "string"
    && typeof candidate.positionsChecked === "number"
    && Array.isArray(candidate.unavailableChains)
    && Array.isArray(candidate.positions)
    && candidate.positions.every((position) => (
      typeof position.chain === "string"
      && typeof position.positionId === "number"
      && typeof position.pair === "string"
      && (position.status === "in-range" || position.status === "out-of-range")
      && typeof position.inRange === "boolean"
      && Array.isArray(position.tokens)
      && typeof position.currentValue === "string"
      && typeof position.initialValue === "string"
      && typeof position.profitLoss === "string"
      && typeof position.rewards === "string"
      && typeof position.observedAt === "string"
    ));
}
