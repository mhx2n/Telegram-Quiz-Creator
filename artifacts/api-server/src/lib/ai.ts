type AIMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ChatCreateParams = {
  messages: AIMessage[];
};

type ChatCreateResult = {
  choices: [{ message: { content: string } }];
};

const AI_PROVIDER_URLS = (process.env.AI_PROVIDER_URLS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GEMINI_API_KEYS = (process.env.GEMINI_API_KEYS ?? "")
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);

// 🔧 prompt builder
function buildPrompt(messages: AIMessage[]): string {
  return messages.map((m) => `${m.role}: ${m.content}`).join("\n");
}

// =====================
// 1️⃣ PROVIDER CALL
// =====================
async function callProvider(url: string, prompt: string): Promise<string> {
  const full = new URL(url);
  full.searchParams.set("prompt", prompt);

  const res = await fetch(full.toString());
  const raw = await res.text();

  try {
    const data = JSON.parse(raw);
    return (
      data?.response ||
      data?.answer ||
      data?.result ||
      data?.message ||
      raw
    );
  } catch {
    return raw; // fallback
  }
}

// =====================
// 2️⃣ GROQ CALL
// =====================
async function callGroq(prompt: string): Promise<string> {
  if (!GROQ_API_KEY) throw new Error("No GROQ key");

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: "llama3-70b-8192",
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

// =====================
// 3️⃣ GEMINI CALL
// =====================
async function callGemini(prompt: string): Promise<string> {
  if (!GEMINI_API_KEYS.length) throw new Error("No Gemini key");

  const key = GEMINI_API_KEYS[Math.floor(Math.random() * GEMINI_API_KEYS.length)];

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    }
  );

  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

// =====================
// 🚀 MAIN FALLBACK FLOW
// =====================
async function createChatCompletion(
  params: ChatCreateParams
): Promise<ChatCreateResult> {
  const prompt = buildPrompt(params.messages);

  // 1️⃣ Provider
  for (const url of AI_PROVIDER_URLS) {
    try {
      console.log("TRY PROVIDER:", url);
      const res = await callProvider(url, prompt);
      if (res) return { choices: [{ message: { content: res } }] };
    } catch (e) {
      console.log("Provider failed");
    }
  }

  // 2️⃣ Groq
  try {
    console.log("TRY GROQ");
    const res = await callGroq(prompt);
    if (res) return { choices: [{ message: { content: res } }] };
  } catch {
    console.log("Groq failed");
  }

  // 3️⃣ Gemini
  try {
    console.log("TRY GEMINI");
    const res = await callGemini(prompt);
    if (res) return { choices: [{ message: { content: res } }] };
  } catch {
    console.log("Gemini failed");
  }

  throw new Error("ALL AI FAILED ❌");
}

export const aiClient = {
  chat: {
    completions: {
      create: createChatCompletion,
    },
  },
} as const;

export const AI_MODEL = "fallback-system";
export const AI_SUPPORTS_VISION = false;
