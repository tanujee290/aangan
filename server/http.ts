export const NO_STORE = { "Cache-Control": "no-store" } as const;

/** JSON error response used by every API route. */
export function bad(status: number, message: string, headers: Record<string, string> = {}) {
  return Response.json({ error: message }, { status, headers: { ...NO_STORE, ...headers } });
}

/** Reads a JSON body, refusing anything larger than `maxBytes`. Returns undefined when it isn't valid JSON. */
export async function readJson<T>(req: Request, maxBytes: number): Promise<T | undefined | "too_large"> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return "too_large";
  const text = await req.text();
  if (text.length > maxBytes) return "too_large";
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/** Maps an upstream AI error to a status: 429 stays 429 so the browser can tell the user to wait. */
export function upstreamStatus(err: unknown) {
  return (err as { status?: unknown } | null)?.status === 429 ? 429 : 502;
}
