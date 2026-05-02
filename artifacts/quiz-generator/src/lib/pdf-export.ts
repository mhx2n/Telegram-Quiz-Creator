import jsPDF from "jspdf";

interface QuizQuestion {
  question: string;
  options: string[];
  correctOptionIndex: number;
  explanation?: string;
}

interface QuizData {
  title: string;
  questions: QuizQuestion[];
  createdAt: string;
  telegramChannel?: string | null;
}

export type PdfTheme = "teal" | "blue" | "purple" | "dark" | "minimal";
export type PdfContentMode = "questions" | "answers" | "full";

export interface PdfOptions {
  theme: PdfTheme;
  contentMode: PdfContentMode;
  watermarkText: string;
  watermarkOpacity: number;
  headerLeft: string;
  headerRight: string;
  footerLeft: string;
  showPageNumbers: boolean;
  separateSheets: boolean;
}

export const defaultPdfOptions: PdfOptions = {
  theme: "teal",
  contentMode: "full",
  watermarkText: "",
  watermarkOpacity: 15,
  headerLeft: "Telegram Quiz Generator",
  headerRight: "",
  footerLeft: "",
  showPageNumbers: true,
  separateSheets: false,
};

interface ThemeColors {
  primary: [number, number, number];
  correctBg: [number, number, number];
  correctText: [number, number, number];
  expBg: [number, number, number];
  expText: [number, number, number];
  headerBg: [number, number, number];
  headerFg: [number, number, number];
  footerBg: [number, number, number];
  qBg: [number, number, number];
  qBorder: [number, number, number];
  lineColor: [number, number, number];
}

const THEMES: Record<PdfTheme, ThemeColors> = {
  teal: {
    primary: [0, 123, 110],
    correctBg: [209, 250, 229],
    correctText: [6, 95, 70],
    expBg: [239, 246, 255],
    expText: [29, 78, 216],
    headerBg: [0, 123, 110],
    headerFg: [255, 255, 255],
    footerBg: [240, 242, 241],
    qBg: [247, 250, 249],
    qBorder: [200, 220, 217],
    lineColor: [0, 123, 110],
  },
  blue: {
    primary: [37, 99, 235],
    correctBg: [219, 234, 254],
    correctText: [29, 78, 216],
    expBg: [240, 249, 255],
    expText: [14, 116, 144],
    headerBg: [37, 99, 235],
    headerFg: [255, 255, 255],
    footerBg: [241, 245, 249],
    qBg: [248, 250, 252],
    qBorder: [203, 213, 225],
    lineColor: [37, 99, 235],
  },
  purple: {
    primary: [124, 58, 237],
    correctBg: [237, 233, 254],
    correctText: [109, 40, 217],
    expBg: [250, 245, 255],
    expText: [126, 34, 206],
    headerBg: [124, 58, 237],
    headerFg: [255, 255, 255],
    footerBg: [245, 243, 255],
    qBg: [250, 248, 255],
    qBorder: [216, 180, 254],
    lineColor: [124, 58, 237],
  },
  dark: {
    primary: [30, 41, 59],
    correctBg: [220, 252, 231],
    correctText: [6, 95, 70],
    expBg: [241, 245, 249],
    expText: [51, 65, 85],
    headerBg: [15, 23, 42],
    headerFg: [255, 255, 255],
    footerBg: [30, 41, 59],
    qBg: [248, 250, 252],
    qBorder: [148, 163, 184],
    lineColor: [71, 85, 105],
  },
  minimal: {
    primary: [0, 0, 0],
    correctBg: [243, 255, 243],
    correctText: [0, 100, 0],
    expBg: [250, 250, 250],
    expText: [80, 80, 80],
    headerBg: [255, 255, 255],
    headerFg: [0, 0, 0],
    footerBg: [255, 255, 255],
    qBg: [255, 255, 255],
    qBorder: [200, 200, 200],
    lineColor: [0, 0, 0],
  },
};

function buildDoc(
  quiz: QuizData,
  opts: PdfOptions,
  mode: PdfContentMode,
  sheetLabel?: string
): jsPDF {
  const t = THEMES[opts.theme];
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentW = pageW - margin * 2;
  let y = margin;

  const drawWatermark = () => {
    if (!opts.watermarkText.trim()) return;
    const opacity = Math.max(1, Math.min(100, opts.watermarkOpacity)) / 100;
    const gray = Math.round(255 - (255 - 180) * opacity);
    doc.setTextColor(gray, gray, gray);
    doc.setFontSize(52);
    doc.setFont("helvetica", "bold");
    doc.text(opts.watermarkText, pageW / 2, pageH / 2, {
      align: "center",
      angle: 45,
    });
    doc.setTextColor(0, 0, 0);
  };

  const drawHeader = () => {
    const isMinimal = opts.theme === "minimal";
    if (isMinimal) {
      doc.setDrawColor(...t.lineColor);
      doc.setLineWidth(0.8);
      doc.line(margin, margin + 10, pageW - margin, margin + 10);
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      const leftH = opts.headerLeft || "Quiz";
      doc.text(leftH, margin, margin + 7);
      const rightH = opts.headerRight || `Page ${doc.getCurrentPageInfo().pageNumber}`;
      doc.text(rightH, pageW - margin, margin + 7, { align: "right" });
      y = margin + 14;
    } else {
      doc.setFillColor(...t.headerBg);
      doc.rect(0, 0, pageW, 11, "F");
      doc.setTextColor(...t.headerFg);
      doc.setFontSize(7.5);
      doc.setFont("helvetica", "bold");
      const leftH = opts.headerLeft || "Quiz Generator";
      doc.text(leftH, margin, 7.5);
      const rightH = opts.headerRight || (opts.showPageNumbers ? `Page ${doc.getCurrentPageInfo().pageNumber}` : "");
      if (rightH) doc.text(rightH, pageW - margin, 7.5, { align: "right" });
      doc.setTextColor(0, 0, 0);
      y = Math.max(y, 14);
    }
  };

  const drawFooter = (pageNum: number, totalPages: number) => {
    const isMinimal = opts.theme === "minimal";
    if (isMinimal) {
      doc.setDrawColor(...t.lineColor);
      doc.setLineWidth(0.4);
      doc.line(margin, pageH - 10, pageW - margin, pageH - 10);
      doc.setTextColor(120, 120, 120);
      doc.setFontSize(7.5);
      doc.setFont("helvetica", "normal");
      const fl = opts.footerLeft || "Telegram Quiz Generator";
      doc.text(fl, margin, pageH - 5);
      if (opts.showPageNumbers) doc.text(`${pageNum} / ${totalPages}`, pageW - margin, pageH - 5, { align: "right" });
    } else {
      doc.setFillColor(...t.footerBg);
      doc.rect(0, pageH - 10, pageW, 10, "F");
      const isDark = opts.theme === "dark";
      doc.setTextColor(isDark ? 180 : 100, isDark ? 180 : 100, isDark ? 180 : 100);
      doc.setFontSize(7.5);
      doc.setFont("helvetica", "normal");
      const fl = opts.footerLeft || "Generated by Telegram Quiz Generator";
      doc.text(fl, margin, pageH - 3.5);
      if (opts.showPageNumbers) doc.text(`${pageNum} / ${totalPages}`, pageW - margin, pageH - 3.5, { align: "right" });
    }
  };

  const addPage = () => {
    doc.addPage();
    drawWatermark();
    y = margin;
    drawHeader();
  };

  const checkPage = (needed: number) => {
    if (y + needed > pageH - 14) addPage();
  };

  drawWatermark();
  drawHeader();

  const isMinimal = opts.theme === "minimal";
  doc.setDrawColor(...t.lineColor);
  if (!isMinimal) {
    doc.setFillColor(...t.primary);
    doc.roundedRect(margin - 2, y, contentW + 4, 14, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
  } else {
    doc.setTextColor(0, 0, 0);
  }
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  const titleLabel = sheetLabel ? `${quiz.title} — ${sheetLabel}` : quiz.title;
  const titleLines = doc.splitTextToSize(titleLabel, contentW - 6);
  doc.text(titleLines, margin + 1, y + 9);
  y += titleLines.length * 7 + 8;

  doc.setTextColor(100, 100, 100);
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "normal");
  const dateStr = new Date(quiz.createdAt).toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" });
  const subtitle = `${quiz.questions.length} Questions  •  ${dateStr}${quiz.telegramChannel ? `  •  ${quiz.telegramChannel}` : ""}`;
  doc.text(subtitle, margin, y);
  y += 6;

  doc.setDrawColor(...t.lineColor);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageW - margin, y);
  y += 5;

  const letters = ["A", "B", "C", "D", "E", "F"];

  quiz.questions.forEach((q, i) => {
    const showAnswers = mode === "answers" || mode === "full";
    const showExplanation = mode === "full" && !!q.explanation;

    const qLines = doc.splitTextToSize(`Q${i + 1}.  ${q.question}`, contentW - 10);
    const optBlocks = q.options.map((opt, j) => {
      const lines = doc.splitTextToSize(`  ${letters[j]}.  ${opt}`, contentW - 14);
      return { lines, isCorrect: j === q.correctOptionIndex };
    });
    const expLines = showExplanation && q.explanation
      ? doc.splitTextToSize(`Explanation: ${q.explanation}`, contentW - 10)
      : [];

    const qH = 4 + qLines.length * 5.2;
    const optH = optBlocks.reduce((s, b) => s + b.lines.length * 4.3 + 1.5, 0);
    const expH = expLines.length > 0 ? expLines.length * 4.3 + 6 : 0;
    const blockH = qH + optH + expH + 8;
    checkPage(blockH);

    doc.setFillColor(...t.qBg);
    doc.setDrawColor(...t.qBorder);
    doc.setLineWidth(0.3);
    doc.roundedRect(margin - 2, y, contentW + 4, blockH, 2, 2, "FD");

    doc.setFillColor(...t.primary);
    doc.circle(margin + 3.5, y + 4.5, 3.2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "bold");
    doc.text(`${i + 1}`, margin + 3.5, y + 5.3, { align: "center" });

    doc.setTextColor(20, 20, 20);
    doc.setFontSize(9.5);
    doc.setFont("helvetica", "bold");
    doc.text(qLines, margin + 8, y + 4.5);
    y += qH;

    optBlocks.forEach(({ lines, isCorrect }) => {
      const showHighlight = showAnswers && isCorrect;
      if (showHighlight) {
        doc.setFillColor(...t.correctBg);
        doc.setDrawColor(...t.correctText);
        doc.setLineWidth(0.2);
        doc.roundedRect(margin + 2, y - 0.5, contentW - 2, lines.length * 4.3 + 1.5, 1, 1, "FD");
        doc.setTextColor(...t.correctText);
        doc.setFont("helvetica", "bold");
      } else {
        doc.setTextColor(55, 55, 55);
        doc.setFont("helvetica", "normal");
      }
      doc.setFontSize(8.5);
      doc.text(lines, margin + 6, y + 3);
      if (showHighlight) {
        doc.setFontSize(9);
        doc.text("✓", pageW - margin - 4, y + 3);
      }
      y += lines.length * 4.3 + 1.5;
    });

    if (expLines.length > 0) {
      y += 2;
      doc.setFillColor(...t.expBg);
      doc.setDrawColor(...t.expText);
      doc.setLineWidth(0.2);
      doc.roundedRect(margin + 2, y - 0.5, contentW - 2, expLines.length * 4.3 + 3, 1, 1, "FD");
      doc.setTextColor(...t.expText);
      doc.setFontSize(8);
      doc.setFont("helvetica", "italic");
      doc.text(expLines, margin + 5, y + 2.5);
      y += expLines.length * 4.3 + 5;
    }

    y += 6;
  });

  const total = (doc.internal as unknown as { getNumberOfPages: () => number }).getNumberOfPages();
  for (let pg = 1; pg <= total; pg++) {
    doc.setPage(pg);
    drawFooter(pg, total);
  }

  return doc;
}

function safeName(title: string) {
  return title.replace(/[^a-zA-Z0-9\s\u0980-\u09FF_-]/g, "").trim() || "quiz";
}

export function exportQuizAsPDF(quiz: QuizData, opts: PdfOptions = defaultPdfOptions): void {
  if (opts.separateSheets) {
    const docQ = buildDoc(quiz, opts, "questions", "Question Sheet");
    docQ.save(`${safeName(quiz.title)}_questions.pdf`);
    const docA = buildDoc(quiz, opts, "full", "Answer Key");
    docA.save(`${safeName(quiz.title)}_answer_key.pdf`);
  } else {
    const doc = buildDoc(quiz, opts, opts.contentMode);
    doc.save(`${safeName(quiz.title)}.pdf`);
  }
}
