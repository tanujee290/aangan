import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "./env.js";

export const MODEL = "claude-opus-5-5";

/**
 * On Netlify, AI Gateway injects ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL automatically.
 * On Vercel and Cloudflare, set ANTHROPIC_API_KEY yourself (ANTHROPIC_BASE_URL is optional).
 */
export const aiConfigured = (env: Env) => Boolean(env.ANTHROPIC_API_KEY);

export function createAnthropic(env: Env): Anthropic {
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL || undefined });
}

export type ClientFactory = (env: Env) => Pick<Anthropic, "messages">;
