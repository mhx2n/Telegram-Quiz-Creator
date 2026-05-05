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
  return messages
    .map((m) => `${m.role.toUpperCase()}:\n${contentToText(m.content)}`)
    .join("\n\n");
}

async function callProvider(providerUrl: string, prompt: string): Promise<string> {
  const url = new URL(providerUrl);
  url.searchParams.set("prompt", prompt);

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  const raw = await res.text();

  if (!res.ok) {
    throw new Error(`AI provider failed: ${res.status} ${raw.slice(0, 250)}`);
  }

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("AI provider returned non-JSON response");
  }

  const answer =
    data?.response ??
    data?.answer ??
    data?.result ??
    data?.message ??
    "";

  if (typeof answer !== "string" || !answer.trim()) {
    throw new Error("AI provider returned empty response");
  }

  return answer.trim();
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
      const answer = await callProvider(providerUrl, prompt);
      console.log("[ai] success:", providerUrl);
      return {
        choices: [{ message: { content: answer } }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${providerUrl}: ${message}`);
      console.log("[ai] failed:", providerUrl, message);
      continue;
    }
  }

  throw new Error(`All AI providers failed. Tried: ${errors.join(" | ")}`);
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
