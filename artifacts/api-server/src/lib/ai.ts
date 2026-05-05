type ChatCreateParams = {
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string | Array<{ type: string; [key: string]: unknown }>;
  }>;
  model?: string;
  max_completion_tokens?: number;
  temperature?: number;
};

type ChatCreateResult = {
  choices: Array<{
    message: {
      content: string | null;
    };
  }>;
};

type AIMessage = ChatCreateParams["messages"][number];

const LOCAL_AI_API_URL = process.env.LOCAL_AI_API_URL?.trim() || "http://127.0.0.1:5000/api/ask";

function contentToText(content: AIMessage["content"]): string {
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part.type === "text" && typeof part.text === "string") return part.text;
        if (part.type === "image_url") return "[IMAGE ATTACHED]";
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  return String(content ?? "");
}

function buildPrompt(messages: ChatCreateParams["messages"]): string {
  const systemParts = messages
    .filter((m) => m.role === "system")
    .map((m) => contentToText(m.content))
    .filter(Boolean);

  const otherParts = messages
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role.toUpperCase()}:\n${contentToText(m.content)}`)
    .filter(Boolean);

  return [
    ...systemParts,
    ...otherParts,
  ].join("\n\n");
}

async function callLocalAi(prompt: string): Promise<string> {
  const url = new URL(LOCAL_AI_API_URL);
  url.searchParams.set("prompt", prompt);

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Local AI API failed: ${res.status} ${text.slice(0, 300)}`);
  }

  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Local AI API returned non-JSON response: ${text.slice(0, 300)}`);
  }

  const answer =
    data?.answer ??
    data?.response ??
    data?.result ??
    data?.message ??
    "";

  if (typeof answer !== "string" || !answer.trim()) {
    throw new Error("Local AI API returned empty answer");
  }

  return answer.trim();
}

async function createChatCompletion(params: ChatCreateParams): Promise<ChatCreateResult> {
  const prompt = buildPrompt(params.messages);

  console.log("[ai-local] sending prompt to:", LOCAL_AI_API_URL);
  console.log("[ai-local] prompt length:", prompt.length);

  const answer = await callLocalAi(prompt);

  console.log("[ai-local] received answer length:", answer.length);

  return {
    choices: [
      {
        message: {
          content: answer,
        },
      },
    ],
  };
}

export const aiClient = {
  chat: {
    completions: {
      create: createChatCompletion,
    },
  },
} as const;

export const AI_MODEL = "local-api";
export const AI_SUPPORTS_VISION = false;

export type { AIMessage };
