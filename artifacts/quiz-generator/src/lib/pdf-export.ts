import jsPDF from "jspdf";
import html2canvas from "html2canvas";

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

interface ThemeCSS {
  primary: string;
  headerBg: string;
  headerFg: string;
  qBg: string;
  qBorder: string;
  correctBg: string;
  correctText: string;
  expBg: string;
  expText: string;
  divider: string;
}

const THEMES: Record<PdfTheme, ThemeCSS> = {
  teal: {
    primary: "#007B6E",
    headerBg: "#007B6E", headerFg: "#fff",
    qBg: "#f7faf9", qBorder: "#c8dcda",
    correctBg: "#d1fae5", correctText: "#065f46",
    expBg: "#eff6ff", expText: "#1d4ed8",
    divider: "#007B6E",
  },
  blue: {
    primary: "#2563EB",
    headerBg: "#2563EB", headerFg: "#fff",
    qBg: "#f8fafc", qBorder: "#cbd5e1",
    correctBg: "#dbeafe", correctText: "#1d4ed8",
    expBg: "#f0f9ff", expText: "#0e7490",
    divider: "#2563EB",
  },
  purple: {
    primary: "#7C3AED",
    headerBg: "#7C3AED", headerFg: "#fff",
    qBg: "#faf8ff", qBorder: "#d8b4fe",
    correctBg: "#ede9fe", correctText: "#6d28d9",
    expBg: "#faf5ff", expText: "#7e22ce",
    divider: "#7C3AED",
  },
  dark: {
    primary: "#1e293b",
    headerBg: "#0f172a", headerFg: "#e2e8f0",
    qBg: "#f8fafc", qBorder: "#94a3b8",
    correctBg: "#dcfce7", correctText: "#065f46",
    expBg: "#f1f5f9", expText: "#334155",
    divider: "#475569",
  },
  minimal: {
    primary: "#000",
    headerBg: "#f8f8f8", headerFg: "#000",
    qBg: "#fff", qBorder: "#e0e0e0",
    correctBg: "#f0fff0", correctText: "#006400",
    expBg: "#fafafa", expText: "#555",
    divider: "#000",
  },
};

function escH(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeName(title: string) {
  return title.replace(/[^a-zA-Z0-9\s\u0980-\u09FF_-]/g, "").trim() || "quiz";
}

function buildHTML(quiz: QuizData, opts: PdfOptions, mode: PdfContentMode, sheetLabel?: string): string {
  const t = THEMES[opts.theme];
  const showAnswers = mode === "answers" || mode === "full";
  const showExpl = mode === "full";
  const letters = ["A", "B", "C", "D", "E"];
  const isMinimal = opts.theme === "minimal";
  const title = sheetLabel ? `${quiz.title} — ${sheetLabel}` : quiz.title;
  const date = new Date(quiz.createdAt).toLocaleDateString("en-GB", {
    year: "numeric", month: "long", day: "numeric",
  });

  const questionsHTML = quiz.questions.map((q, i) => {
    const optionsHTML = q.options.map((opt, j) => {
      const isCorrect = j === q.correctOptionIndex && showAnswers;
      return `<div class="opt${isCorrect ? " cor" : ""}">
        <span class="ol">${letters[j]}.</span>
        <span class="ot">${escH(opt)}</span>
        ${isCorrect ? `<span class="chk">✓</span>` : ""}
      </div>`;
    }).join("");

    const explHTML =
      showExpl && q.explanation
        ? `<div class="expl">💡 ${escH(q.explanation)}</div>`
        : "";

    return `<div class="qb">
      <div class="qh">
        <span class="qnum">${i + 1}</span>
        <span class="qtext">${escH(q.question)}</span>
      </div>
      <div class="opts">${optionsHTML}</div>
      ${explHTML}
    </div>`;
  }).join("");

  const wmOpacity = Math.max(1, Math.min(60, opts.watermarkOpacity)) / 100;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: 'Segoe UI', 'Noto Sans Bengali', 'SolaimanLipi', 'Kalpurush',
               'Vrinda', 'Arial Unicode MS', Arial, sans-serif;
  font-size: 13px; background: #fff; color: #1a1a1a;
  width: 780px; min-height: 1px;
}
.wrap { padding: 18px 24px 20px; position: relative; overflow: hidden; }
.wm {
  position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%) rotate(45deg);
  font-size: 72px; font-weight: 900;
  color: rgba(140,140,140,${wmOpacity});
  pointer-events: none; white-space: nowrap; z-index: 99;
  letter-spacing: 6px;
  font-family: Arial, sans-serif;
}
.hdr {
  background: ${t.headerBg};
  color: ${t.headerFg};
  padding: 7px 14px;
  display: flex; justify-content: space-between; align-items: center;
  font-size: 10px; font-weight: 600; letter-spacing: 0.3px;
  border-radius: ${isMinimal ? "0" : "4px 4px 0 0"};
  ${isMinimal ? "border-bottom: 2px solid #000;" : ""}
  font-family: Arial, sans-serif;
}
.ttl {
  background: ${isMinimal ? "#fff" : t.primary};
  color: ${isMinimal ? "#000" : "#fff"};
  padding: ${isMinimal ? "10px 14px 6px" : "11px 14px"};
  font-size: 15px; font-weight: 700; line-height: 1.35;
  border-radius: ${isMinimal ? "0" : "0 0 4px 4px"};
  ${isMinimal ? "border-bottom: 1.5px solid #000;" : ""}
}
.meta { font-size: 10px; color: #888; margin: 6px 0 10px; font-family: Arial, sans-serif; }
.div { height: 1.5px; background: ${t.divider}; opacity: 0.2; margin-bottom: 12px; }
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  align-items: start;
}
.qb {
  background: ${t.qBg};
  border: 1px solid ${t.qBorder};
  border-radius: 6px; padding: 9px 11px;
  break-inside: avoid; page-break-inside: avoid;
}
.qh { display: flex; align-items: flex-start; gap: 7px; margin-bottom: 7px; }
.qnum {
  background: ${t.primary}; color: #fff;
  border-radius: 50%; min-width: 19px; height: 19px;
  display: flex; align-items: center; justify-content: center;
  font-size: 8px; font-weight: 700; flex-shrink: 0; margin-top: 1px;
  font-family: Arial, sans-serif;
}
.qtext { font-size: 11px; font-weight: 600; line-height: 1.45; color: #111; }
.opts { display: flex; flex-direction: column; gap: 2.5px; }
.opt {
  display: flex; align-items: flex-start; gap: 4px;
  padding: 3px 6px; border-radius: 3px;
  font-size: 10px; line-height: 1.4; color: #444;
}
.opt.cor {
  background: ${t.correctBg}; color: ${t.correctText};
  font-weight: 600; border: 1px solid ${t.correctText}30;
}
.ol { font-weight: 700; min-width: 14px; flex-shrink: 0; font-family: Arial, sans-serif; }
.ot { flex: 1; }
.chk { margin-left: auto; flex-shrink: 0; font-family: Arial, sans-serif; font-size: 11px; }
.expl {
  margin-top: 6px; padding: 4px 7px;
  background: ${t.expBg}; color: ${t.expText};
  font-size: 9.5px; border-radius: 4px; line-height: 1.4;
  border-left: 2px solid ${t.expText}70;
}
.ftr {
  margin-top: 14px; padding-top: 6px;
  border-top: 1px solid #e0e0e0;
  display: flex; justify-content: space-between;
  font-size: 9px; color: #aaa;
  font-family: Arial, sans-serif;
}
</style>
</head>
<body>
<div class="wrap">
  ${opts.watermarkText ? `<div class="wm">${escH(opts.watermarkText)}</div>` : ""}
  <div class="hdr">
    <span>${escH(opts.headerLeft || "Telegram Quiz Generator")}</span>
    <span>${escH(opts.headerRight || "")}</span>
  </div>
  <div class="ttl">${escH(title)}</div>
  <div class="meta">
    ${quiz.questions.length} Questions &nbsp;•&nbsp; ${date}
    ${quiz.telegramChannel ? ` &nbsp;•&nbsp; ${escH(quiz.telegramChannel)}` : ""}
  </div>
  <div class="div"></div>
  <div class="grid">${questionsHTML}</div>
  <div class="ftr">
    <span>${escH(opts.footerLeft || "Generated by Telegram Quiz Generator")}</span>
    <span></span>
  </div>
</div>
</body>
</html>`;
}

async function renderToPDF(html: string, opts: PdfOptions, filename: string): Promise<void> {
  const A4_W = 780;
  const A4_H_SLICE = 1060;
  const SCALE = 2;

  const container = document.createElement("div");
  container.style.cssText = `
    position: fixed; top: -99999px; left: 0;
    width: ${A4_W}px;
    background: #ffffff;
    overflow: visible;
  `;
  container.innerHTML = html;
  document.body.appendChild(container);

  try {
    await new Promise((r) => setTimeout(r, 120));

    const canvas = await html2canvas(container, {
      scale: SCALE,
      width: A4_W,
      useCORS: true,
      allowTaint: true,
      logging: false,
      backgroundColor: "#ffffff",
      windowWidth: A4_W,
      removeContainer: false,
    });

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const PAGE_W_MM = 210;
    const PAGE_H_MM = 297;
    const pageSliceH = A4_H_SLICE * SCALE;
    const totalPages = Math.ceil(canvas.height / pageSliceH);

    for (let p = 0; p < totalPages; p++) {
      if (p > 0) doc.addPage();

      const startY = p * pageSliceH;
      const sliceH = Math.min(pageSliceH, canvas.height - startY);

      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = canvas.width;
      pageCanvas.height = pageSliceH;
      const ctx = pageCanvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      ctx.drawImage(
        canvas,
        0, startY, canvas.width, sliceH,
        0, 0, canvas.width, sliceH
      );

      const imgData = pageCanvas.toDataURL("image/jpeg", 0.93);
      doc.addImage(imgData, "JPEG", 0, 0, PAGE_W_MM, PAGE_H_MM);

      if (opts.showPageNumbers) {
        doc.setFontSize(8);
        doc.setTextColor(160, 160, 160);
        doc.text(`${p + 1} / ${totalPages}`, PAGE_W_MM - 14, PAGE_H_MM - 5, { align: "right" });
      }
    }

    doc.save(filename);
  } finally {
    document.body.removeChild(container);
  }
}

export async function exportQuizAsPDF(
  quiz: QuizData,
  opts: PdfOptions = defaultPdfOptions
): Promise<void> {
  const name = safeName(quiz.title);

  if (opts.separateSheets) {
    const htmlQ = buildHTML(quiz, opts, "questions", "Question Sheet");
    await renderToPDF(htmlQ, opts, `${name}_questions.pdf`);
    const htmlA = buildHTML(quiz, opts, "full", "Answer Key");
    await renderToPDF(htmlA, opts, `${name}_answer_key.pdf`);
  } else {
    const html = buildHTML(quiz, opts, opts.contentMode);
    await renderToPDF(html, opts, `${name}.pdf`);
  }
}
