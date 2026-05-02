interface QuizQuestion {
  question: string;
  options: string[];
  correctOptionIndex: number;
  explanation?: string;
  type?: string;
  section?: string;
}

interface QuizData {
  title: string;
  questions: QuizQuestion[];
}

function csvCell(value: string): string {
  const escaped = (value ?? "").replace(/"/g, '""');
  return `"${escaped}"`;
}

export function exportQuizAsCSV(quiz: QuizData): void {
  const headers = ["questions", "option1", "option2", "option3", "option4", "option5", "answer", "explanation", "type", "section"];
  const rows: string[] = [headers.join(",")];

  for (const q of quiz.questions) {
    const opts = [...q.options];
    while (opts.length < 5) opts.push("");
    const answer = q.options[q.correctOptionIndex] ?? "";
    const row = [
      csvCell(q.question),
      csvCell(opts[0] ?? ""),
      csvCell(opts[1] ?? ""),
      csvCell(opts[2] ?? ""),
      csvCell(opts[3] ?? ""),
      csvCell(opts[4] ?? ""),
      csvCell(answer),
      csvCell(q.explanation ?? ""),
      csvCell(q.type ?? "mcq"),
      csvCell(q.section ?? ""),
    ];
    rows.push(row.join(","));
  }

  const bom = "\uFEFF";
  const csvContent = bom + rows.join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${quiz.title.replace(/[^a-zA-Z0-9\s\u0980-\u09FF]/g, "").trim() || "quiz"}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportQuizAsJSON(quiz: QuizData & { id: number; createdAt: string; telegramChannel?: string | null }): void {
  const data = {
    metadata: {
      title: quiz.title,
      id: quiz.id,
      generatedAt: quiz.createdAt,
      totalQuestions: quiz.questions.length,
      telegramChannel: quiz.telegramChannel ?? null,
      exportedAt: new Date().toISOString(),
      generator: "Telegram Quiz Generator",
    },
    questions: quiz.questions.map((q, i) => ({
      index: i + 1,
      question: q.question,
      options: q.options.map((opt, j) => ({
        label: String.fromCharCode(65 + j),
        text: opt,
        isCorrect: j === q.correctOptionIndex,
      })),
      correctAnswer: q.options[q.correctOptionIndex],
      correctOptionIndex: q.correctOptionIndex,
      explanation: q.explanation ?? null,
      type: q.type ?? "mcq",
      section: q.section ?? null,
    })),
  };

  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${quiz.title.replace(/[^a-zA-Z0-9\s\u0980-\u09FF]/g, "").trim() || "quiz"}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
