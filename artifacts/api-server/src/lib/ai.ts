import OpenAI from "openai";

type ChatCreate = OpenAI["chat"]["completions"]["create"];
type ChatCreateParams = Parameters<ChatCreate>[0];
type ChatCreateResult = Awaited<ReturnType<ChatCreate>>;

type ProviderName = "gemini" | "groq" | "openai" | "replit";

type ProviderConfig = {
  name: ProviderName;
  label: string;
  client: OpenAI;
  model: string;
  supportsVision: boolean;
};

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

function splitKeys(value?: string | null): string[] {
  return [...new Set(
    (value ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  )];
}

function makeProviderLabel(name: ProviderName, index: number) {
  return `${name}#${index + 1}`;
}

function buildProviders(): ProviderConfig[] {
  const providers: ProviderConfig[] = [];

  const geminiKeys = [
    ...splitKeys(process.env.GEMINI_API_KEYS),
    ...(process.env.GEMINI_API_KEY ? [process.env.GEMINI_API_KEY.trim()] : []),
  ].filter(Boolean);

  const groqKeys = [
    ...splitKeys(process.env.GROQ_API_KEYS),
    ...(process.env.GROQ_API_KEY ? [process.env.GROQ_API_KEY.trim()] : []),
  ].filter(Boolean);

  const openaiKeys = [
    ...splitKeys(process.env.OPENAI_API_KEYS),
    ...(process.env.OPENAI_API_KEY ? [process.env.OPENAI_API_KEY.trim()] : []),
  ].filter(Boolean);

  // Gemini first
  geminiKeys.forEach((key, index) => {
    providers.push({
      name: "gemini",
      label: makeProviderLabel("gemini", index),
      client: new OpenAI({
        apiKey: key,
        baseURL: GEMINI_BASE_URL,
      }),
      model: process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash",
      supportsVision: true,
    });
  });

  // Groq next
  groqKeys.forEach((key, index) => {
    providers.push({
      name: "groq",
      label: makeProviderLabel("groq", index),
      client: new OpenAI({
        apiKey: key,
        baseURL: GROQ_BASE_URL,
      }),
      model: process.env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile",
      supportsVision: false,
    });
  });

  // OpenAI after that
  openaiKeys.forEach((key, index) => {
    providers.push({
      name: "openai",
      label: makeProviderLabel("openai", index),
      client: new OpenAI({
        apiKey: key,
      }),
      model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
      supportsVision: true,
    });
  });

  // Replit proxy last
  if (process.env.AI_INTEGRATIONS_OPENAI_BASE_URL && process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    providers.push({
      name: "replit",
      label: "replit#1",
      client: new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      }),
      model: process.env.REPLIT_MODEL?.trim() || "gpt-4o-mini",
      supportsVision: true,
    });
  }

  return providers;
}

const providers = buildProviders();

console.log(
  "[ai] providers loaded:",
  providers.map((p) => `${p.label}:${p.model}:${p.supportsVision ? "vision" : "text-only"}`).join(", ") || "none"
);

function hasVisionInput(messages: ChatCreateParams["messages"]): boolean {
  return messages.some((msg: any) => {
    const content = msg?.content;
    return (
      Array.isArray(content) &&
      content.some((part: any) => part?.type === "image_url" || part?.type === "input_image")
    );
  });
}

function isRetryableProviderError(error: unknown): boolean {
  const e = error as any;

  const text = [
    e?.message,
    e?.error?.message,
    e?.error?.type,
    e?.error?.code,
    e?.code,
    e?.status,
    e?.response?.status,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return /insufficient_quota|quota|rate\s*limit|too many requests|billing|resource exhausted|429|503|temporarily unavailable/.test(text);
}

async function createChatCompletion(params: ChatCreateParams): Promise<ChatCreateResult> {
  const needsVision = hasVisionInput(params.messages);
  const candidateProviders = providers.filter((p) => !needsVision || p.supportsVision);

  console.log("[ai] request start", {
    needsVision,
    totalProviders: providers.length,
    candidateProviders: candidateProviders.map((p) => p.label),
    modelFromCall: (params as any)?.model,
  });

  if (!candidateProviders.length) {
    throw new Error("No vision-capable AI provider configured. Add a Gemini, OpenAI, or Replit key.");
  }

  const errors: string[] = [];

  for (const provider of candidateProviders) {
    try {
      console.log("[ai] trying provider:", provider.label, "model:", provider.model);

      const result = await provider.client.chat.completions.create({
        ...params,
        model: provider.model,
      } as ChatCreateParams);

      console.log("[ai] success provider:", provider.label);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log("[ai] failed provider:", provider.label, "message:", message);

      if (!isRetryableProviderError(error)) {
        console.log("[ai] non-retryable error, stopping on:", provider.label);
        throw error;
      }

      errors.push(`${provider.label}: ${message}`);
      continue;
    }
  }

  throw new Error(`All AI providers exhausted or rate-limited. Tried: ${errors.join(" | ")}`);
}

export const aiClient = {
  chat: {
    completions: {
      create: createChatCompletion,
    },
  },
} as unknown as OpenAI;

export const AI_MODEL = providers[0]?.model ?? "gpt-4o-mini";
export const AI_SUPPORTS_VISION = providers.some((p) => p.supportsVision);

export type AIMessage = Parameters<ChatCreate>[0]["messages"][number];
