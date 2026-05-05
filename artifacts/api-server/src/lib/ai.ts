type AIMessage = {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: string; [key: string]: unknown }>;
};

type ChatCreateParams = {
  messages: AIMessage[];
};

type ChatCreateResult = {
  choices: [{ message: { content: string | null } }];
};

const AI_PROVIDER_URLS = (process.env.AI_PROVIDER_URLS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function contentToText(content: AIMessage["content"]): string {
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part.type === "text" && typeof (part as any).text === "string") return (part as any).text;
        if (part.type === "image_url") return "[IMAGE]";
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  return String(content ?? "");
}

function buildPrompt(messages: AIMessage[]): string {
  const raw = messages
    .map((m) => `${m.role.toUpperCase()}:\n${contentToText(m.content)}`)
    .join("\n\n");

  // 🔥 LIMIT PROMPT SIZE (VERY IMPORTANT)
  return raw.slice(0, 4000);
}

// ⏱ timeout helper
async function fetchWithTimeout(url: string, timeout = 20000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    return await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(id);
  }
}

async function callProvider(providerUrl: string, prompt: string): Promise<string> {
  const url = new URL(providerUrl);
  url.searchParams.set("prompt", prompt);

  const res = await fetchWithTimeout(url.toString(), 20000); // ⏱ 20 sec max

  const raw = await res.text();

  if (!res.ok) {
    throw new Error(`AI provider failed: ${res.status} ${raw.slice(0, 200)}`);
  }

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("AI provider returned non-JSON");
  }

  const answer =
    data?.response ??
    data?.answer ??
    data?.result ??
    data?.message ??
    "";

  if (!answer || typeof answer !== "string") {
    throw new Error("Empty response");
  }

  return answer.trim();
}

async function tryProviderWithRetry(url: string, prompt: string): Promise<string> {
  const retries = 2;

  for (let i = 0; i <= retries; i++) {
    try {
      return await callProvider(url, prompt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      console.log(`[ai] retry ${i} failed:`, url, msg);

      if (i === retries) throw err;

      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  throw new Error("Retry failed");
}

async function createChatCompletion(params: ChatCreateParams): Promise<ChatCreateResult> {
  if (!AI_PROVIDER_URLS.length) {
    throw new Error("No AI_PROVIDER_URLS configured");
  }

  const prompt = buildPrompt(params.messages);
  const errors: string[] = [];

  for (const providerUrl of AI_PROVIDER_URLS) {
    try {
      console.log("[ai] trying:", providerUrl);

      const answer = await tryProviderWithRetry(providerUrl, prompt);

      console.log("[ai] success:", providerUrl);

      return {
        choices: [{ message: { content: answer } }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      console.log("[ai] failed:", providerUrl, message);

      errors.push(`${providerUrl}: ${message}`);

      continue;
    }
  }

  throw new Error(`All AI providers failed:\n${errors.join("\n")}`);
}

export const aiClient = {
  chat: {
    completions: {
      create: createChatCompletion,
    },
  },
} as const;

export const AI_MODEL = "http-wrapper";
export const AI_SUPPORTS_VISION = false;

export type { AIMessage };
