import OpenAI from "openai";

type ChatCreate = OpenAI["chat"]["completions"]["create"];
type ChatCreateParams = Parameters<ChatCreate>[0];
type ChatCreateResult = Awaited<ReturnType<ChatCreate>>;

type ProviderName = "groq" | "gemini" | "openai" | "replit";

type ProviderConfig = {
  name: ProviderName;
  client: OpenAI;
  model: string;
  supportsVision: boolean;
};

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

function splitKeys(value?: string | null): string[] {
  return [...new Set((value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean))];
}

function buildProviders(): ProviderConfig[] {
  const providers: ProviderConfig[] = [];

  const groqKeys = [
    ...splitKeys(process.env.GROQ_API_KEYS),
    ...(process.env.GROQ_API_KEY ? [process.env.GROQ_API_KEY.trim()] : []),
  ].filter(Boolean);

  const geminiKeys = [
    ...splitKeys(process.env.GEMINI_API_KEYS),
    ...(process.env.GEMINI_API_KEY ? [process.env.GEMINI_API_KEY.trim()] : []),
  ].filter(Boolean);

  const openaiKeys = [
    ...splitKeys(process.env.OPENAI_API_KEYS),
    ...(process.env.OPENAI_API_KEY ? [process.env.OPENAI_API_KEY.trim()] : []),
  ].filter(Boolean);

  for (const key of groqKeys) {
    providers.push({
      name: "groq",
      client: new OpenAI({
        apiKey: key,
        baseURL: GROQ_BASE_URL,
      }),
      model: process.env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile",
      supportsVision: false,
    });
  }

  for (const key of geminiKeys) {
    providers.push({
      name: "gemini",
      client: new OpenAI({
        apiKey: key,
        baseURL: GEMINI_BASE_URL,
      }),
      model: process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash",
      supportsVision: true,
    });
  }

  for (const key of openaiKeys) {
    providers.push({
      name: "openai",
      client: new OpenAI({
        apiKey: key,
      }),
      model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
      supportsVision: true,
    });
  }

  if (process.env.AI_INTEGRATIONS_OPENAI_BASE_URL && process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    providers.push({
      name: "replit",
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
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return /insufficient_quota|quota|rate\s*limit|too many requests|billing|resource exhausted|429/.test(text);
}

async function createChatCompletion(params: ChatCreateParams): Promise<ChatCreateResult> {
  const needsVision = hasVisionInput(params.messages);
  const candidateProviders = providers.filter((p) => !needsVision || p.supportsVision);

  if (!candidateProviders.length) {
    throw new Error("No vision-capable AI provider configured. Add a Gemini or OpenAI key.");
  }

  const errors: string[] = [];

  for (const provider of candidateProviders) {
    try {
      return await provider.client.chat.completions.create({
        ...params,
        model: provider.model,
      } as ChatCreateParams);
    } catch (error) {
      if (!isRetryableProviderError(error)) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${provider.name}: ${message}`);
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
