import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, quizzesTable } from "@workspace/db";
import {
  GenerateQuizBody,
  GetQuizParams,
  UpdateQuizParams,
  UpdateQuizBody,
  DeleteQuizParams,
  PostQuizToTelegramParams,
  PostQuizToTelegramBody,
  ExportQuizParams,
  ExportQuizQueryParams,
} from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";

const router = Router();

router.get("/quizzes", async (req, res) => {
  const quizzes = await db.select().from(quizzesTable).orderBy(quizzesTable.createdAt);
  res.json(quizzes.map(formatQuiz));
});

router.get("/quizzes/stats", async (req, res) => {
  const all = await db.select().from(quizzesTable).orderBy(quizzesTable.createdAt);
  const totalQuizzes = all.length;
  const totalQuestions = all.reduce((s, q) => s + (q.questionCount ?? 0), 0);
  const postedToTelegram = all.filter((q) => q.postedToTelegram).length;
  const recentQuizzes = all.slice(-5).reverse().map(formatQuiz);
  res.json({ totalQuizzes, totalQuestions, postedToTelegram, recentQuizzes });
});

router.post("/quizzes", async (req, res) => {
  const parsed = GenerateQuizBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request: " + parsed.error.message });
    return;
  }
  const { content, title, imageBase64, questionCount = 5, language = "Bengali" } = parsed.data;

  try {
    const messages: Array<{ role: "user" | "system"; content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> }> = [
      {
        role: "system",
        content: `You are a quiz generator. Generate exactly ${questionCount} multiple choice questions from the provided content. Respond ONLY with valid JSON. The language of the quiz questions and answers should be in ${language}. Return a JSON array like:
[{"question":"...","options":["A","B","C","D"],"correctOptionIndex":0,"explanation":"..."}]
Rules:
- Each question must have exactly 4 options
- correctOptionIndex is 0-based (0=A, 1=B, 2=C, 3=D)
- explanation field is required and should be in ${language}
- Questions should test understanding, not just facts
- Do not include any text outside the JSON array
- Do not wrap in markdown code blocks`,
      },
    ];

    const userText = content?.trim()
      ? `Generate ${questionCount} quiz questions from this content:\n\n${content}`
      : `Generate ${questionCount} quiz questions from the image.`;

    if (imageBase64) {
      messages.push({
        role: "user",
        content: [
          { type: "text", text: userText },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
        ],
      });
    } else {
      messages.push({ role: "user", content: userText });
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_completion_tokens: 16000,
      messages: messages as Parameters<typeof openai.chat.completions.create>[0]["messages"],
    });

    const raw = response.choices[0]?.message?.content ?? "[]";
    let questions: Array<{ question: string; options: string[]; correctOptionIndex: number; explanation?: string }> = [];

    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    const jsonStr = jsonMatch ? jsonMatch[0] : cleaned;

    try {
      questions = JSON.parse(jsonStr);
    } catch {
      req.log.error({ raw: raw.slice(0, 500) }, "Failed to parse AI JSON response");
      res.status(500).json({ error: "AI returned an invalid response. Please try again." });
      return;
    }

    if (!Array.isArray(questions) || questions.length === 0) {
      res.status(500).json({ error: "AI returned no questions. Try with more detailed content." });
      return;
    }

    const validQuestions = questions.filter(
      (q) => q.question && Array.isArray(q.options) && q.options.length >= 2 && typeof q.correctOptionIndex === "number"
    );

    if (validQuestions.length === 0) {
      res.status(500).json({ error: "AI returned malformed questions. Please try again." });
      return;
    }

    const quizTitle = title || `Quiz - ${new Date().toLocaleDateString("bn-BD")}`;
    const [quiz] = await db
      .insert(quizzesTable)
      .values({
        title: quizTitle,
        sourceContent: content,
        questions: validQuestions,
        questionCount: validQuestions.length,
        postedToTelegram: false,
      })
      .returning();

    res.status(201).json(formatQuiz(quiz));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Quiz generation failed");
    if (message.includes("timeout") || message.includes("ETIMEDOUT")) {
      res.status(504).json({ error: "Request timed out. Try fewer questions or smaller image." });
    } else if (message.includes("insufficient_quota") || message.includes("billing")) {
      res.status(402).json({ error: "AI service quota exceeded. Please try again later." });
    } else {
      res.status(500).json({ error: "Quiz generation failed: " + message });
    }
  }
});

router.get("/quizzes/:id", async (req, res) => {
  const parsed = GetQuizParams.safeParse({ id: req.params.id });
  if (!parsed.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const [quiz] = await db.select().from(quizzesTable).where(eq(quizzesTable.id, parsed.data.id));
  if (!quiz) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatQuiz(quiz));
});

router.put("/quizzes/:id", async (req, res) => {
  const paramsParsed = UpdateQuizParams.safeParse({ id: req.params.id });
  if (!paramsParsed.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const bodyParsed = UpdateQuizBody.safeParse(req.body);
  if (!bodyParsed.success) { res.status(400).json({ error: bodyParsed.error.message }); return; }
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (bodyParsed.data.title) updates.title = bodyParsed.data.title;
  if (bodyParsed.data.questions) {
    updates.questions = bodyParsed.data.questions;
    updates.questionCount = bodyParsed.data.questions.length;
  }
  const [quiz] = await db.update(quizzesTable).set(updates).where(eq(quizzesTable.id, paramsParsed.data.id)).returning();
  if (!quiz) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatQuiz(quiz));
});

router.delete("/quizzes/:id", async (req, res) => {
  const parsed = DeleteQuizParams.safeParse({ id: req.params.id });
  if (!parsed.success) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(quizzesTable).where(eq(quizzesTable.id, parsed.data.id));
  res.status(204).send();
});

router.post("/quizzes/:id/mark-posted", async (req, res) => {
  const parsed = GetQuizParams.safeParse({ id: req.params.id });
  if (!parsed.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const { channelId } = req.body as { channelId?: string };
  await db.update(quizzesTable)
    .set({ postedToTelegram: true, telegramChannel: channelId ?? null, updatedAt: new Date() })
    .where(eq(quizzesTable.id, parsed.data.id));
  res.json({ success: true });
});

router.post("/quizzes/:id/post-to-telegram", async (req, res) => {
  const paramsParsed = PostQuizToTelegramParams.safeParse({ id: req.params.id });
  if (!paramsParsed.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const bodyParsed = PostQuizToTelegramBody.safeParse(req.body);
  if (!bodyParsed.success) { res.status(400).json({ error: bodyParsed.error.message }); return; }

  const [quiz] = await db.select().from(quizzesTable).where(eq(quizzesTable.id, paramsParsed.data.id));
  if (!quiz) { res.status(404).json({ error: "Not found" }); return; }

  const { botToken, channelId, questionIndex } = bodyParsed.data;
  const questions = quiz.questions as Array<{ question: string; options: string[]; correctOptionIndex: number; explanation?: string }>;
  const toPost = questionIndex != null ? [questions[questionIndex]].filter(Boolean) : questions;

  const messageIds: number[] = [];
  for (const q of toPost) {
    const payload = {
      chat_id: channelId,
      question: q.question,
      options: q.options,
      type: "quiz",
      correct_option_id: q.correctOptionIndex,
      explanation: q.explanation || undefined,
      is_anonymous: true,
    };
    const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendPoll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await resp.json() as { ok: boolean; result?: { message_id: number } };
    if (!data.ok) {
      res.status(400).json({ error: `Telegram error: ${JSON.stringify(data)}` });
      return;
    }
    if (data.result) messageIds.push(data.result.message_id);
  }

  await db.update(quizzesTable).set({ postedToTelegram: true, telegramChannel: channelId, updatedAt: new Date() }).where(eq(quizzesTable.id, paramsParsed.data.id));
  res.json({ success: true, postedCount: messageIds.length, messageIds });
});

router.get("/quizzes/:id/export", async (req, res) => {
  const paramsParsed = ExportQuizParams.safeParse({ id: req.params.id });
  if (!paramsParsed.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const queryParsed = ExportQuizQueryParams.safeParse(req.query);
  if (!queryParsed.success) { res.status(400).json({ error: queryParsed.error.message }); return; }

  const [quiz] = await db.select().from(quizzesTable).where(eq(quizzesTable.id, paramsParsed.data.id));
  if (!quiz) { res.status(404).json({ error: "Not found" }); return; }

  const questions = quiz.questions as Array<{ question: string; options: string[]; correctOptionIndex: number; explanation?: string }>;
  const format = queryParsed.data.format;

  if (format === "json") {
    const data = JSON.stringify({ title: quiz.title, questions }, null, 2);
    res.json({ data, filename: `${quiz.title}.json`, format });
  } else {
    const rows = ["Question,Option A,Option B,Option C,Option D,Correct Answer,Explanation"];
    for (const q of questions) {
      const opts = q.options.map((o) => `"${o.replace(/"/g, '""')}"`);
      while (opts.length < 4) opts.push('""');
      const correct = q.options[q.correctOptionIndex] ?? "";
      const exp = q.explanation ? `"${q.explanation.replace(/"/g, '""')}"` : '""';
      rows.push([`"${q.question.replace(/"/g, '""')}"`, ...opts.slice(0, 4), `"${correct}"`, exp].join(","));
    }
    res.json({ data: rows.join("\n"), filename: `${quiz.title}.csv`, format });
  }
});

function formatQuiz(quiz: typeof quizzesTable.$inferSelect) {
  return {
    id: quiz.id,
    title: quiz.title,
    sourceContent: quiz.sourceContent,
    questions: quiz.questions,
    questionCount: quiz.questionCount,
    createdAt: quiz.createdAt,
    updatedAt: quiz.updatedAt,
    postedToTelegram: quiz.postedToTelegram,
    telegramChannel: quiz.telegramChannel ?? null,
  };
}

export default router;
