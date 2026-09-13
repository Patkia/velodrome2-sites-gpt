export type PositionStatus = "in-range" | "out-of-range";

export interface DashboardPosition {
  chain: string;
  chainId: number;
  positionId: string;
  source: "staked" | "unstaked";
  liquidity: string;
  token0: string;
  token0Symbol: string | null;
  token0Decimals: number | null;
  token1: string;
  token1Symbol: string | null;
  token1Decimals: number | null;
  tickLower: number;
  tickUpper: number;
  currentTick: number;
  inRange: boolean;
  status: PositionStatus;
}

export interface PositionsResponse {
  schemaVersion: 1;
  status: "ok" | "partial";
  generatedAt: string;
  walletAddress: string;
  positionsChecked: number;
  positions: DashboardPosition[];
  chainCounts: {
    Optimism: number;
    Celo: number;
    Soneium: number;
  };
  unavailableChains: string[];
  warnings: string[];
}

export function filterPositions(positions: DashboardPosition[], chain: string): DashboardPosition[] {
  return chain === "all" ? positions : positions.filter((position) => position.chain === chain);
}

export function isPositionsResponse(value: unknown): value is PositionsResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<PositionsResponse>;

  return candidate.schemaVersion === 1
    && (candidate.status === "ok" || candidate.status === "partial")
    && typeof candidate.generatedAt === "string"
    && typeof candidate.walletAddress === "string"
    && typeof candidate.positionsChecked === "number"
    && Array.isArray(candidate.unavailableChains)
    && Array.isArray(candidate.warnings)
    && typeof candidate.chainCounts === "object"
    && candidate.chainCounts !== null
    && typeof candidate.chainCounts.Optimism === "number"
    && typeof candidate.chainCounts.Celo === "number"
    && typeof candidate.chainCounts.Soneium === "number"
    && Array.isArray(candidate.positions)
    && candidate.positions.every((position) => (
      typeof position.chain === "string"
      && typeof position.chainId === "number"
      && typeof position.positionId === "string"
      && (position.source === "staked" || position.source === "unstaked")
      && typeof position.liquidity === "string"
      && typeof position.token0 === "string"
      && (typeof position.token0Symbol === "string" || position.token0Symbol === null)
      && (typeof position.token0Decimals === "number" || position.token0Decimals === null)
      && typeof position.token1 === "string"
      && (typeof position.token1Symbol === "string" || position.token1Symbol === null)
      && (typeof position.token1Decimals === "number" || position.token1Decimals === null)
      && typeof position.tickLower === "number"
      && typeof position.tickUpper === "number"
      && typeof position.currentTick === "number"
      && typeof position.inRange === "boolean"
      && (position.status === "in-range" || position.status === "out-of-range")
    ));
}
