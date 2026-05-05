export type AIMessage = {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: string; [key: string]: unknown }>;
};

type ChatParams = {
  messages: AIMessage[];
  max_completion_tokens?: number;
  temperature?: number;
  model?: string;
};

type ChatResult = {
  choices: [{ message: { content: string | null } }];
};

function contentToText(content: AIMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => {
        if (p.type === "text" && typeof (p as Record<string, unknown>).text === "string")
          return (p as Record<string, unknown>).text as string;
        if (p.type === "image_url") return "[IMAGE]";
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

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function tryExternalUrl(messages: AIMessage[]): Promise<string> {
  const base = "https://gemini-prplexity.onrender.com/api/ask";
  const prompt = buildPrompt(messages);
  const url = new URL(base);
  url.searchParams.set("prompt", prompt);

  const res = await fetchWithTimeout(url.toString(), { method: "GET", headers: { Accept: "application/json" } }, 60000);
  const raw = await res.text();
  if (!res.ok) throw new Error(`External AI ${res.status}: ${raw.slice(0, 200)}`);

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("External AI returned non-JSON");
  }

  const answer = (data?.response ?? data?.answer ?? data?.result ?? data?.message ?? data?.text ?? "") as string;
  if (!answer?.trim()) throw new Error("External AI returned empty response");
  return answer.trim();
}

async function tryGroq(messages: AIMessage[], params: ChatParams): Promise<string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY not set");

  const body = {
    model: "llama-3.1-8b-instant",
    messages: messages.map((m) => ({ role: m.role, content: contentToText(m.content) })),
    max_tokens: params.max_completion_tokens ?? 8000,
    temperature: params.temperature ?? 0.5,
  };

  const res = await fetchWithTimeout("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  }, 45000);

  const raw = await res.text();
  if (!res.ok) {
    if (res.status === 429) throw new Error("RATE_LIMIT: Groq rate limited");
    throw new Error(`Groq ${res.status}: ${raw.slice(0, 200)}`);
  }

  const data = JSON.parse(raw) as { choices: [{ message: { content: string } }] };
  const answer = data?.choices?.[0]?.message?.content ?? "";
  if (!answer.trim()) throw new Error("Groq returned empty response");
  return answer.trim();
}

async function tryGemini(messages: AIMessage[], params: ChatParams): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");

  const systemMsg = messages.find((m) => m.role === "system");
  const userMsgs = messages.filter((m) => m.role !== "system");

  const contents = userMsgs.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: contentToText(m.content) }],
  }));

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      maxOutputTokens: params.max_completion_tokens ?? 8000,
      temperature: params.temperature ?? 0.5,
    },
  };

  if (systemMsg) {
    body.systemInstruction = { parts: [{ text: contentToText(systemMsg.content) }] };
  }

  const model = "gemini-2.0-flash";
  const res = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    45000,
  );

  const raw = await res.text();
  if (!res.ok) {
    if (res.status === 429) throw new Error("RATE_LIMIT: Gemini rate limited");
    throw new Error(`Gemini ${res.status}: ${raw.slice(0, 200)}`);
  }

  const data = JSON.parse(raw) as { candidates?: [{ content: { parts: [{ text: string }] } }] };
  const answer = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!answer.trim()) throw new Error("Gemini returned empty response");
  return answer.trim();
}

async function tryReplitOpenAI(messages: AIMessage[], params: ChatParams): Promise<string> {
  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!baseUrl || !apiKey) throw new Error("Replit OpenAI integration not configured");

  const body = {
    model: "gpt-4o-mini",
    messages: messages.map((m) => ({ role: m.role, content: contentToText(m.content) })),
    max_completion_tokens: params.max_completion_tokens ?? 8000,
    temperature: params.temperature ?? 0.5,
  };

  const res = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  }, 45000);

  const raw = await res.text();
  if (!res.ok) {
    if (res.status === 429) throw new Error("RATE_LIMIT: Replit OpenAI rate limited");
    throw new Error(`Replit OpenAI ${res.status}: ${raw.slice(0, 200)}`);
  }

  const data = JSON.parse(raw) as { choices: [{ message: { content: string } }] };
  const answer = data?.choices?.[0]?.message?.content ?? "";
  if (!answer.trim()) throw new Error("Replit OpenAI returned empty response");
  return answer.trim();
}

type Provider = { name: string; fn: (msgs: AIMessage[], params: ChatParams) => Promise<string> };

function getProviders(params: ChatParams): Provider[] {
  return [
    { name: "external", fn: (msgs) => tryExternalUrl(msgs) },
    { name: "groq", fn: (msgs) => tryGroq(msgs, params) },
    { name: "gemini", fn: (msgs) => tryGemini(msgs, params) },
    { name: "replit-openai", fn: (msgs) => tryReplitOpenAI(msgs, params) },
  ];
}

async function createChatCompletion(params: ChatParams): Promise<ChatResult> {
  const providers = getProviders(params);
  const errors: string[] = [];

  for (const provider of providers) {
    try {
      console.log(`[ai] trying: ${provider.name}`);
      const answer = await provider.fn(params.messages, params);
      console.log(`[ai] success: ${provider.name}`);
      return { choices: [{ message: { content: answer } }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`[${provider.name}] ${msg}`);
      console.log(`[ai] failed: ${provider.name} — ${msg}`);
      continue;
    }
  }

  throw new Error(`All AI providers exhausted. Errors: ${errors.join(" | ")}`);
}

export const aiClient = {
  chat: {
    completions: {
      create: createChatCompletion,
    },
  },
} as const;

export const AI_MODEL = "multi-provider";
export const AI_SUPPORTS_VISION = false;

export async function warmupExternalProvider(): Promise<void> {
  try {
    const url = new URL("https://gemini-prplexity.onrender.com/api/ask");
    url.searchParams.set("prompt", "ping");
    await fetch(url.toString(), { method: "GET", signal: AbortSignal.timeout(5000) });
    console.log("[ai] external provider warmed up");
  } catch {
    console.log("[ai] external provider warmup ping sent (may be waking)");
  }
}
