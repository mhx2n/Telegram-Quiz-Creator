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

type QuizQuestion = {
  question: string;
  options: string[];
  correctOptionIndex: number;
  explanation?: string;
};

type AIMessage = Parameters<typeof openai.chat.completions.create>[0]["messages"][number];

async function generateQuestionsFromMessages(
  messages: AIMessage[],
  count: number,
  language: string,
  existingQuestions: QuizQuestion[] = []
): Promise<QuizQuestion[]> {
  const existingCtx =
    existingQuestions.length > 0
      ? `\n\nDo NOT repeat these questions that already exist:\n${existingQuestions
          .slice(-20)
          .map((q) => `- ${q.question}`)
          .join("\n")}`
      : "";

  const systemMsg: AIMessage = {
    role: "system",
    content: `You are a quiz generator. Generate exactly ${count} multiple choice questions from the provided content. Respond ONLY with valid JSON. The language should be ${language}.${existingCtx}
Return a JSON array like:
[{"question":"...","options":["A","B","C","D"],"correctOptionIndex":0,"explanation":"..."}]
Rules:
- Each question must have exactly 4 options
- correctOptionIndex is 0-based (0=A, 1=B, 2=C, 3=D)
- explanation is required and in ${language}
- Test understanding, not just memory
- Output ONLY the JSON array, no markdown, no extra text`,
  };

  const callMessages: AIMessage[] = [systemMsg, ...messages];

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_completion_tokens: 16000,
    messages: callMessages,
  });

  const raw = response.choices[0]?.message?.content ?? "[]";
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
  const jsonStr = jsonMatch ? jsonMatch[0] : cleaned;

  const parsed = JSON.parse(jsonStr) as QuizQuestion[];
  return parsed.filter(
    (q) =>
      q.question &&
      Array.isArray(q.options) &&
      q.options.length >= 2 &&
      typeof q.correctOptionIndex === "number"
  );
}

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
  const { content = "", title, imageBase64, questionCount = 5, language = "Bengali" } = parsed.data;

  if (!content.trim() && !imageBase64) {
    res.status(400).json({ error: "Please provide text content or an image." });
    return;
  }

  try {
    const userText = content?.trim()
      ? `Generate quiz questions from this content:\n\n${content}`
      : `Generate quiz questions from the image.`;

    const baseUserContent: AIMessage["content"] = imageBase64
      ? [
          { type: "text" as const, text: userText },
          { type: "image_url" as const, image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
        ]
      : userText;

    const userMessage: AIMessage = { role: "user", content: baseUserContent };

    const BATCH = 20;
    let allQuestions: QuizQuestion[] = [];

    if (questionCount <= BATCH) {
      allQuestions = await generateQuestionsFromMessages([userMessage], questionCount, language, []);
    } else {
      let batchNum = 0;
      while (allQuestions.length < questionCount) {
        const remaining = questionCount - allQuestions.length;
        const batchSize = Math.min(BATCH, remaining);

        const batchUserContent: AIMessage["content"] = imageBase64
          ? [
              {
                type: "text" as const,
                text: `Generate ${batchSize} quiz questions (batch ${batchNum + 1}) from this content:\n\n${content || "the image"}`,
              },
              { type: "image_url" as const, image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
            ]
          : `Generate ${batchSize} quiz questions (batch ${batchNum + 1}) from this content:\n\n${content}`;

        const batchMsg: AIMessage = { role: "user", content: batchUserContent };
        const batchResult = await generateQuestionsFromMessages([batchMsg], batchSize, language, allQuestions);
        allQuestions = [...allQuestions, ...batchResult];
        batchNum++;

        if (batchResult.length === 0) break;
      }
    }

    if (!allQuestions || allQuestions.length === 0) {
      res.status(500).json({ error: "AI returned no questions. Try with more detailed content." });
      return;
    }

    const quizTitle = title || `Quiz - ${new Date().toLocaleDateString("bn-BD")}`;
    const [quiz] = await db
      .insert(quizzesTable)
      .values({
        title: quizTitle,
        sourceContent: content,
        questions: allQuestions,
        questionCount: allQuestions.length,
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

router.post("/quizzes/:id/add-questions", async (req, res) => {
  const idNum = parseInt(req.params.id ?? "0", 10);
  if (!idNum) { res.status(400).json({ error: "Invalid id" }); return; }

  const { additionalCount = 5, language = "Bengali" } = req.body as {
    additionalCount?: number;
    language?: string;
  };

  const count = Math.max(1, Math.min(50, Number(additionalCount) || 5));

  const [quiz] = await db.select().from(quizzesTable).where(eq(quizzesTable.id, idNum));
  if (!quiz) { res.status(404).json({ error: "Not found" }); return; }

  try {
    const existingQuestions = (quiz.questions ?? []) as QuizQuestion[];
    const sourceContent = quiz.sourceContent ?? "";

    const userText = sourceContent.trim()
      ? `Generate more quiz questions from this content:\n\n${sourceContent}`
      : `Generate ${count} more diverse quiz questions on the same topics as these existing questions.`;

    const userMessage: AIMessage = { role: "user", content: userText };

    const BATCH = 20;
    let newQuestions: QuizQuestion[] = [];

    if (count <= BATCH) {
      newQuestions = await generateQuestionsFromMessages([userMessage], count, language, existingQuestions);
    } else {
      let batchNum = 0;
      const allExisting = [...existingQuestions];
      while (newQuestions.length < count) {
        const remaining = count - newQuestions.length;
        const batchSize = Math.min(BATCH, remaining);
        const batchMsg: AIMessage = {
          role: "user",
          content: `Generate more quiz questions (batch ${batchNum + 1}) from this content:\n\n${sourceContent}`,
        };
        const batchResult = await generateQuestionsFromMessages([batchMsg], batchSize, language, [
          ...allExisting,
          ...newQuestions,
        ]);
        newQuestions = [...newQuestions, ...batchResult];
        batchNum++;
        if (batchResult.length === 0) break;
      }
    }

    if (newQuestions.length === 0) {
      res.status(500).json({ error: "Failed to generate additional questions." });
      return;
    }

    const merged = [...existingQuestions, ...newQuestions];
    const [updated] = await db
      .update(quizzesTable)
      .set({ questions: merged, questionCount: merged.length, updatedAt: new Date() })
      .where(eq(quizzesTable.id, idNum))
      .returning();

    res.json({ ...formatQuiz(updated), addedCount: newQuestions.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Add questions failed");
    res.status(500).json({ error: "Failed to generate questions: " + message });
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
  const questions = quiz.questions as QuizQuestion[];
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

  const questions = quiz.questions as QuizQuestion[];
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
