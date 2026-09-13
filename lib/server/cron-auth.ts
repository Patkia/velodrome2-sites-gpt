type AuthResult =
  | { ok: true }
  | { ok: false; response: Response };

function errorResponse(status: number, code: string): Response {
  return Response.json(
    { status: "error", error: { code } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

async function sha256(value: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(value);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index++) diff |= left[index] ^ right[index];
  return diff === 0;
}

async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([sha256(left), sha256(right)]);
  return equalBytes(leftDigest, rightDigest);
}

export async function authorizeCronRequest(
  expectedSecret: string | undefined,
  authorization: string | null,
): Promise<AuthResult> {
  if (!expectedSecret) {
    return { ok: false, response: errorResponse(500, "CRON_AUTH_UNAVAILABLE") };
  }

  if (!authorization?.startsWith("Bearer ")) {
    return { ok: false, response: errorResponse(401, "UNAUTHORIZED") };
  }

  const providedSecret = authorization.slice(7);
  if (!(await constantTimeEqual(expectedSecret, providedSecret))) {
    return { ok: false, response: errorResponse(401, "UNAUTHORIZED") };
  }

  return { ok: true };
}
