import { POSITIONS_FIXTURE } from "@/lib/shared/positions-schema";

export async function GET(): Promise<Response> {
  return Response.json(POSITIONS_FIXTURE, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
