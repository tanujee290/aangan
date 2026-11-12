import { vi } from "vitest";

export const SUPABASE = { VITE_SUPABASE_URL: "https://demo.supabase.co/", VITE_SUPABASE_ANON_KEY: "anon-key" };
export const AI = { ANTHROPIC_API_KEY: "test-key" };

export function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://aangan.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** A fake Anthropic client whose messages.create returns `result` (or throws it when `fail` is set). */
export function fakeClient(result: unknown, fail = false) {
  const create = vi.fn(async (_params: Record<string, unknown>) => {
    if (fail) throw result;
    return result;
  });
  return { create, factory: () => ({ messages: { create } }) as never };
}

export async function* events(...items: unknown[]) {
  for (const i of items) yield i;
}

export const textDelta = (text: string) => ({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });

/** Stubs fetch so Supabase's /auth/v1/user answers with `status`. Returns the mock to inspect calls. */
export function stubSupabaseAuth(status: number) {
  const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response("{}", { status }));
  vi.stubGlobal("fetch", f);
  return f;
}
