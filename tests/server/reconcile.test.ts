import { describe, expect, it } from "vitest";
import { handleReconcile, MAX_LINES } from "../../server/reconcile";
import { AI, fakeClient, post, SUPABASE } from "../helpers";

const context = (lines: unknown[]) => ({ context: JSON.stringify({ lines, receipts: [], unpaid: [], expenses: [] }) });
const line = { id: "l1", date: "2026-11-05", amount: 15000, narration: "UPI/RAVI" };
const match = { line: "l1", kind: "record", target: "u1", confidence: 90, reason: "Ravi's November rent" };
const reply = (text: string, stop_reason = "end_turn") => ({ stop_reason, content: [{ type: "text", text }] });

describe("POST /api/reconcile", () => {
  it("returns the model's matches", async () => {
    const ai = fakeClient(reply(JSON.stringify({ matches: [match] })));
    const res = await handleReconcile(post("/api/reconcile", context([line])), AI, ai.factory);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ matches: [match] });
    const params = ai.create.mock.calls[0][0] as { output_config: { format: { type: string } } };
    expect(params.output_config.format.type).toBe("json_schema");
  });

  it("requires a session when Supabase is connected", async () => {
    const res = await handleReconcile(post("/api/reconcile", context([line])), { ...SUPABASE, ...AI });
    expect(res.status).toBe(401);
  });

  it("rejects other methods", async () => {
    expect((await handleReconcile(new Request("https://aangan.test/api/reconcile"), AI)).status).toBe(405);
  });

  it("explains when the AI key is missing", async () => {
    expect((await handleReconcile(post("/api/reconcile", context([line])), {})).status).toBe(503);
  });

  it.each([
    ["no lines", context([])],
    ["too many lines", context(Array.from({ length: MAX_LINES + 1 }, (_, i) => ({ ...line, id: `l${i}` })))],
    ["context that isn't JSON", { context: "{oops" }],
    ["missing context", {}],
    ["invalid body", "not json"],
  ])("rejects %s", async (_name, body) => {
    const ai = fakeClient(reply("{}"));
    const res = await handleReconcile(post("/api/reconcile", body), AI, ai.factory);
    expect(res.status).toBe(400);
    expect(ai.create).not.toHaveBeenCalled();
  });

  it("reports a refusal as 422", async () => {
    const ai = fakeClient(reply("", "refusal"));
    expect((await handleReconcile(post("/api/reconcile", context([line])), AI, ai.factory)).status).toBe(422);
  });

  it("treats unreadable model output as an upstream failure", async () => {
    const ai = fakeClient(reply("not json"));
    expect((await handleReconcile(post("/api/reconcile", context([line])), AI, ai.factory)).status).toBe(502);
  });

  it("returns an empty list when the model sends no matches array", async () => {
    const ai = fakeClient(reply(JSON.stringify({ matches: "none" })));
    expect(await (await handleReconcile(post("/api/reconcile", context([line])), AI, ai.factory)).json()).toEqual({ matches: [] });
  });

  it("passes rate limits through as 429", async () => {
    const ai = fakeClient(Object.assign(new Error("slow down"), { status: 429 }), true);
    expect((await handleReconcile(post("/api/reconcile", context([line])), AI, ai.factory)).status).toBe(429);
  });
});
