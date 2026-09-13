import { createLivePositionsResponse } from "@/lib/server/live-positions";

export async function GET(): Promise<Response> {
  return createLivePositionsResponse({
    optimismRpcUrl: process.env.OPTIMISM_RPC_URL,
    walletAddress: process.env.WALLET_ADDRESS,
  });
}
