import OpenAI from "openai";

/**
 * Universal AI client — auto-detects provider from env vars:
 *
 *  1. Replit AI proxy  (REPLIT env, free via integration)
 *  2. Groq             (GROQ_API_KEY — completely FREE, fast)
 *  3. OpenAI           (OPENAI_API_KEY — paid)
 */

function buildClient(): { client: OpenAI; model: string; supportsVision: boolean } {
  // ── Groq (free, highest priority) ─────────────────────────────────────────
  // Always prefer Groq when GROQ_API_KEY is set — works on Render, Vercel, anywhere.
  if (process.env.GROQ_API_KEY) {
    return {
      client: new OpenAI({
        apiKey: process.env.GROQ_API_KEY,
        baseURL: "https://api.groq.com/openai/v1",
      }),
      model: "llama-3.3-70b-versatile",
      supportsVision: false, // Groq text-only
    };
  }

  // ── OpenAI (paid) ─────────────────────────────────────────────────────────
  if (process.env.OPENAI_API_KEY) {
    return {
      client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
      model: "gpt-4o-mini",
      supportsVision: true,
    };
  }

  // ── Replit AI proxy (Replit-hosted only, limited quota) ───────────────────
  if (process.env.AI_INTEGRATIONS_OPENAI_BASE_URL && process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    return {
      client: new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      }),
      model: "gpt-4o-mini",
      supportsVision: true,
    };
  }

  throw new Error(
    "No AI provider configured. Set GROQ_API_KEY (free at https://console.groq.com) " +
    "in your Render environment variables.",
  );
}

const { client, model, supportsVision } = buildClient();

export const aiClient = client;
export const AI_MODEL = model;
export const AI_SUPPORTS_VISION = supportsVision;
export type AIMessage = Parameters<typeof client.chat.completions.create>[0]["messages"][number];
