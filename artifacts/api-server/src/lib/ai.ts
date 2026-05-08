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

const REQUEST_TIMEOUT_MS = 15000;

function buildPrompt(messages: AIMessage[]): string {
  return messages.map((m) => `${m.role.toUpperCase()}:\n${m.content}`).join("\n\n");
}

function buildQuizPrompt(messages: AIMessage[]): string {
  const base = buildPrompt(messages);

  return `
Return ONLY valid JSON array. No markdown. No code fences. No explanation. No code block.

Example:
[
  {
    "question":"...",
    "options":["A","B","C","D"],
    "correctOptionIndex":0,
    "explanation":"..."
  }
]
Format:
[
  {
    "question": "Question text",
    "options": ["A", "B", "C", "D"],
    "correctOptionIndex": 0,
    "explanation": "Short explanation"
  }
]

Rules:
- Exactly 4 options per question
- correctOptionIndex must be 0-3
- Use plain text JSON only
- If you cannot comply, still return a JSON array

${base}
`.trim();
}

async function fetchText(url: string, init: RequestInit): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
    });

    const raw = await res.text();

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${raw.slice(0, 300)}`);
    }

    return raw;
  } finally {
    clearTimeout(timeout);
  }
}

function stripCodeFences(text: string): string {
  return text
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}

function extractJsonCandidate(text: string): string | null {
  const cleaned = stripCodeFences(text);

  const arrStart = cleaned.indexOf("[");
  const arrEnd = cleaned.lastIndexOf("]");
  if (arrStart !== -1 && arrEnd !== -1 && arrEnd > arrStart) {
    return cleaned.slice(arrStart, arrEnd + 1);
  }

  const objStart = cleaned.indexOf("{");
  const objEnd = cleaned.lastIndexOf("}");
  if (objStart !== -1 && objEnd !== -1 && objEnd > objStart) {
    return cleaned.slice(objStart, objEnd + 1);
  }

  return cleaned;
}

function parseQuizItems(raw: string): unknown[] | null {
  const candidate = extractJsonCandidate(raw);
  if (!candidate) return null;

  try {
    const parsed = JSON.parse(candidate);

    if (Array.isArray(parsed)) return parsed;

    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      for (const key of ["questions", "items", "data", "result"]) {
        const value = obj[key];
        if (Array.isArray(value)) return value;
      }
    }

    return null;
  } catch {
    return null;
  }
}

function normalizeQuizResponse(raw: string): string | null {
  const items = parseQuizItems(raw);
  if (!items || !items.length) return null;

  const normalized = items
    .map((item) => {
      const q = item as Record<string, unknown>;

      const question = String(q.question ?? q.q ?? "").trim();
      const optionsRaw = q.options ?? q.choices ?? q.answers ?? [];
      const explanation = typeof q.explanation === "string" ? q.explanation.trim() : "";

      const options = Array.isArray(optionsRaw)
        ? optionsRaw.map((v) => String(v).trim()).filter(Boolean)
        : [];

      if (!question || options.length < 4) return null;

      let correctOptionIndex = -1;

      const idx = q.correctOptionIndex ?? q.correct_index;
      if (Number.isInteger(idx)) {
        correctOptionIndex = Number(idx);
      }

      if (correctOptionIndex < 0) {
        const answerText = String(q.correctAnswer ?? q.answer ?? "").trim().toLowerCase();
        if (answerText) {
          correctOptionIndex = options.findIndex(
            (o) => o.trim().toLowerCase() === answerText
          );
        }
      }

      if (correctOptionIndex < 0 || correctOptionIndex > 3) {
        correctOptionIndex = 0;
      }

      return {
        question,
        options: options.slice(0, 4),
        correctOptionIndex,
        explanation,
      };
    })
    .filter(Boolean);

  if (!normalized.length) return null;

  return JSON.stringify(normalized);
}

async function callProvider(url: string, prompt: string): Promise<string> {

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
      }),
      signal: controller.signal,
    });

    const raw = await res.text();

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${raw.slice(0, 300)}`);
    }

    try {
      const data = JSON.parse(raw);

      const text =
        data?.response ||
        data?.answer ||
        data?.result ||
        data?.message ||
        raw;

      if (!text || String(text).trim().length < 20) {
        throw new Error("Empty or weak response");
      }

      return String(text).trim();

    } catch {
      return raw.trim();
    }

  } finally {
    clearTimeout(timeout);
  }
}

async function callGroq(prompt: string): Promise<string> {
  if (!GROQ_API_KEY) throw new Error("No GROQ key");

  const raw = await fetchText("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
    }),
  });

  const data = JSON.parse(raw);
  const text = data?.choices?.[0]?.message?.content || "";

  if (!text || String(text).trim().length < 20) {
    throw new Error("Groq empty");
  }

  return String(text).trim();
}

async function callGemini(prompt: string): Promise<string> {
  if (!GEMINI_API_KEYS.length) {
    throw new Error("No Gemini key");
  }

  const key =
    GEMINI_API_KEYS[
      Math.floor(Math.random() * GEMINI_API_KEYS.length)
    ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
      }),
      signal: controller.signal,
    }
  );

  clearTimeout(timeout);

  const data = await res.json();

  const text =
    data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

  if (!text || text.length < 20) {
    throw new Error("Gemini empty");
  }

  return text;
}

async function createChatCompletion(
  params: ChatCreateParams
): Promise<ChatCreateResult> {
  const prompt = buildQuizPrompt(params.messages);
  const errors: string[] = [];

  for (const url of AI_PROVIDER_URLS) {
    try {
      console.log("TRY PROVIDER:", url);
      const res = await callProvider(url, prompt);
      const normalized = normalizeQuizResponse(res);

      if (normalized) {
        return { choices: [{ message: { content: normalized } }] };
      }

      errors.push(`${url}: invalid quiz JSON`);
    } catch (e) {
      errors.push(`${url}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  try {
    console.log("TRY GROQ");
    const res = await callGroq(prompt);
    const normalized = normalizeQuizResponse(res);

    if (normalized) {
      return { choices: [{ message: { content: normalized } }] };
    }

    errors.push("groq: invalid quiz JSON");
  } catch (e) {
    errors.push(`groq: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    console.log("TRY GEMINI");
    const res = await callGemini(prompt);
    const normalized = normalizeQuizResponse(res);

    if (normalized) {
      return { choices: [{ message: { content: normalized } }] };
    }

    errors.push("gemini: invalid quiz JSON");
  } catch (e) {
    errors.push(`gemini: ${e instanceof Error ? e.message : String(e)}`);
  }

  throw new Error(`ALL AI FAILED ❌ ${errors.join(" | ")}`);
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
