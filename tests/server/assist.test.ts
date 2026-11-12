import { describe, expect, it } from "vitest";
import { handleAssist, PREVIEW_CONTEXT } from "../../server/assist";
import { AI, events, fakeClient, post, stubSupabaseAuth, SUPABASE, textDelta } from "../helpers";

const ask = { context: '{"workspace":{"name":"Demo"}}', messages: [{ role: "user", content: "Who hasn't paid?" }] };

describe("POST /api/assist", () => {
  it("rejects other methods", async () => {
    const res = await handleAssist(new Request("https://aangan.test/api/assist"), AI);
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });

  it("requires a session when Supabase is connected", async () => {
    const res = await handleAssist(post("/api/assist", ask), { ...SUPABASE, ...AI });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Please sign in again." });
  });

  it("rejects an expired session", async () => {
    stubSupabaseAuth(401);
    const res = await handleAssist(post("/api/assist", ask, { Authorization: "Bearer expired-token-123456" }), { ...SUPABASE, ...AI });
    expect(res.status).toBe(401);
  });

  it("streams the answer for a signed-in user", async () => {
    const auth = stubSupabaseAuth(200);
    const ai = fakeClient(events(textDelta("Ravi "), textDelta("owes ₹15,000.")));
    const res = await handleAssist(post("/api/assist", ask, { Authorization: "Bearer valid-token-123456" }), { ...SUPABASE, ...AI }, ai.factory);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-aangan-mode")).toBe("live");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe("Ravi owes ₹15,000.");
    expect(String(auth.mock.calls[0][0])).toBe("https://demo.supabase.co/auth/v1/user");
    expect(ai.create.mock.calls[0][0]).toMatchObject({ max_tokens: 4000, stream: true });
  });

  it("works without Supabase as a preview with tighter limits", async () => {
    const ai = fakeClient(events(textDelta("Hello")));
    const res = await handleAssist(
      post("/api/assist", { ...ask, messages: [{ role: "assistant", content: "Hi!" }, ...ask.messages] }),
      AI,
      ai.factory,
    );
    expect(res.headers.get("x-aangan-mode")).toBe("preview");
    expect(await res.text()).toBe("Hello");
    const params = ai.create.mock.calls[0][0] as { max_tokens: number; messages: unknown[] };
    expect(params.max_tokens).toBe(1500);
    // A leading assistant turn is dropped so the conversation starts with the user.
    expect(params.messages).toEqual([{ role: "user", content: "Who hasn't paid?" }]);
  });

  it("explains when the AI key is missing", async () => {
    const res = await handleAssist(post("/api/assist", ask), {});
    expect(res.status).toBe(503);
  });

  it.each([
    ["invalid JSON", "{nope"],
    ["missing context", { messages: ask.messages }],
    ["oversized preview context", { ...ask, context: "x".repeat(PREVIEW_CONTEXT + 1) }],
    ["no messages", { ...ask, messages: [] }],
    ["empty message", { ...ask, messages: [{ role: "user", content: "  " }] }],
    ["unknown role", { ...ask, messages: [{ role: "system", content: "hi" }] }],
    ["too long message", { ...ask, messages: [{ role: "user", content: "x".repeat(4001) }] }],
    ["last turn not from user", { ...ask, messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }] }],
  ])("rejects %s", async (_name, body) => {
    const ai = fakeClient(events());
    const res = await handleAssist(post("/api/assist", body), AI, ai.factory);
    expect([400, 413]).toContain(res.status);
    expect(ai.create).not.toHaveBeenCalled();
  });

  it("passes rate limits through as 429", async () => {
    const ai = fakeClient(Object.assign(new Error("rate limited"), { status: 429 }), true);
    const res = await handleAssist(post("/api/assist", ask), AI, ai.factory);
    expect(res.status).toBe(429);
  });

  it("maps other upstream failures to 502", async () => {
    const ai = fakeClient(new Error("boom"), true);
    const res = await handleAssist(post("/api/assist", ask), AI, ai.factory);
    expect(res.status).toBe(502);
  });

  it("tells the user when an answer was refused or cut short", async () => {
    const ai = fakeClient(events(textDelta("Partial"), { type: "message_delta", delta: { stop_reason: "max_tokens" } }));
    const res = await handleAssist(post("/api/assist", ask), AI, ai.factory);
    expect(await res.text()).toContain("Answer cut short");
  });

  it("closes the stream cleanly when the connection drops", async () => {
    async function* broken() {
      yield textDelta("Start");
      throw new Error("socket closed");
    }
    const ai = fakeClient(broken());
    const res = await handleAssist(post("/api/assist", ask), AI, ai.factory);
    expect(await res.text()).toBe("Start\n\n(The connection dropped. Please try again.)");
  });
});
