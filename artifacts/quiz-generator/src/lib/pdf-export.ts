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
  columns: 1 | 2;
  fontSize: "small" | "medium" | "large";
}

export const defaultPdfOptions: PdfOptions = {
  theme: "teal",
  contentMode: "full",
  watermarkText: "",
  watermarkOpacity: 15,
  headerLeft: "Quiz Generator",
  headerRight: "",
  footerLeft: "",
  showPageNumbers: true,
  separateSheets: false,
  columns: 2,
  fontSize: "medium",
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
  titleBg: string;
  titleFg: string;
}

const THEMES: Record<PdfTheme, ThemeCSS> = {
  teal: {
    primary: "#007B6E",
    headerBg: "#007B6E", headerFg: "#fff",
    titleBg: "#004d45", titleFg: "#fff",
    qBg: "#f7faf9", qBorder: "#b2d8d4",
    correctBg: "#d1fae5", correctText: "#065f46",
    expBg: "#eff9f7", expText: "#007B6E",
    divider: "#007B6E",
  },
  blue: {
    primary: "#2563EB",
    headerBg: "#1d4ed8", headerFg: "#fff",
    titleBg: "#1e3a8a", titleFg: "#fff",
    qBg: "#f8fafc", qBorder: "#bfdbfe",
    correctBg: "#dbeafe", correctText: "#1d4ed8",
    expBg: "#f0f9ff", expText: "#0369a1",
    divider: "#2563EB",
  },
  purple: {
    primary: "#7C3AED",
    headerBg: "#6d28d9", headerFg: "#fff",
    titleBg: "#4c1d95", titleFg: "#fff",
    qBg: "#faf8ff", qBorder: "#ddd6fe",
    correctBg: "#ede9fe", correctText: "#6d28d9",
    expBg: "#faf5ff", expText: "#7e22ce",
    divider: "#7C3AED",
  },
  dark: {
    primary: "#1e293b",
    headerBg: "#0f172a", headerFg: "#f1f5f9",
    titleBg: "#020617", titleFg: "#e2e8f0",
    qBg: "#f8fafc", qBorder: "#94a3b8",
    correctBg: "#dcfce7", correctText: "#065f46",
    expBg: "#f1f5f9", expText: "#334155",
    divider: "#475569",
  },
  minimal: {
    primary: "#111",
    headerBg: "#f1f1f1", headerFg: "#111",
    titleBg: "#fff", titleFg: "#111",
    qBg: "#fff", qBorder: "#d4d4d4",
    correctBg: "#f0fdf4", correctText: "#166534",
    expBg: "#fafafa", expText: "#555",
    divider: "#111",
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

  const fsMap = { small: "10px", medium: "12px", large: "14px" };
  const baseFontSize = fsMap[opts.fontSize];

  const renderQuestion = (q: QuizQuestion, i: number) => {
    const optionsHTML = q.options.map((opt, j) => {
      const isCorrect = j === q.correctOptionIndex && showAnswers;
      return `<div class="opt${isCorrect ? " cor" : ""}">
        <span class="ol">${letters[j]}</span>
        <span class="ot">${escH(opt)}</span>
        ${isCorrect ? `<span class="chk">✓</span>` : ""}
      </div>`;
    }).join("");

    const explHTML = showExpl && q.explanation
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
  };

  let columnsHTML = "";
  if (opts.columns === 2) {
    const leftQs = quiz.questions.filter((_, i) => i % 2 === 0);
    const rightQs = quiz.questions.filter((_, i) => i % 2 === 1);
    const leftHTML = leftQs.map((q, li) => renderQuestion(q, li * 2)).join("");
    const rightHTML = rightQs.map((q, ri) => renderQuestion(q, ri * 2 + 1)).join("");
    columnsHTML = `<div class="twocol">
      <div class="col">${leftHTML}</div>
      <div class="col">${rightHTML}</div>
    </div>`;
  } else {
    columnsHTML = `<div class="onecol">${quiz.questions.map((q, i) => renderQuestion(q, i)).join("")}</div>`;
  }

  const wmOpacity = Math.max(1, Math.min(60, opts.watermarkOpacity)) / 100;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;600;700&display=swap');
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: 'Noto Sans Bengali', 'Segoe UI', 'SolaimanLipi', 'Kalpurush', 'Vrinda', 'Arial Unicode MS', Arial, sans-serif;
  font-size: ${baseFontSize};
  background: #fff;
  color: #1a1a1a;
  width: 800px;
}
.page { width: 800px; padding: 20px 26px 24px; position: relative; overflow: hidden; }
.wm {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%) rotate(-30deg);
  font-size: 80px; font-weight: 900;
  color: rgba(150,150,150,${wmOpacity});
  pointer-events: none; white-space: nowrap; z-index: 0;
  letter-spacing: 8px;
  font-family: Arial, sans-serif;
}
.hdr {
  background: ${t.headerBg};
  color: ${t.headerFg};
  padding: 6px 14px;
  display: flex; justify-content: space-between; align-items: center;
  font-size: 9px; font-weight: 700; letter-spacing: 0.5px;
  border-radius: ${isMinimal ? "0" : "5px 5px 0 0"};
  ${isMinimal ? "border: 1.5px solid #111; border-bottom: none;" : ""}
  font-family: Arial, sans-serif;
  text-transform: uppercase;
}
.ttl {
  background: ${t.titleBg};
  color: ${t.titleFg};
  padding: 10px 14px 9px;
  font-size: 15px; font-weight: 700; line-height: 1.4;
  border-radius: ${isMinimal ? "0" : "0 0 5px 5px"};
  ${isMinimal ? "border: 1.5px solid #111; border-top: none; border-bottom: none;" : ""}
  position: relative; z-index: 1;
}
.meta {
  font-size: 9px; color: #888; margin: 8px 0 10px;
  font-family: Arial, sans-serif;
  display: flex; gap: 10px; align-items: center;
}
.meta span { display: flex; align-items: center; gap: 3px; }
.div { height: 1.5px; background: ${t.divider}; opacity: 0.25; margin-bottom: 12px; }
.twocol {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  position: relative; z-index: 1;
}
.col {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.onecol {
  display: flex;
  flex-direction: column;
  gap: 8px;
  position: relative; z-index: 1;
}
.qb {
  background: ${t.qBg};
  border: 1px solid ${t.qBorder};
  border-radius: 6px;
  padding: 9px 11px 10px;
  page-break-inside: avoid;
}
.qh { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px; }
.qnum {
  background: ${t.primary}; color: #fff;
  border-radius: 50%;
  min-width: 20px; height: 20px;
  display: flex; align-items: center; justify-content: center;
  font-size: 9px; font-weight: 800; flex-shrink: 0; margin-top: 1px;
  font-family: Arial, sans-serif;
}
.qtext { font-size: ${baseFontSize}; font-weight: 600; line-height: 1.5; color: #111; }
.opts { display: flex; flex-direction: column; gap: 3px; }
.opt {
  display: flex; align-items: flex-start; gap: 5px;
  padding: 3px 7px; border-radius: 4px;
  font-size: calc(${baseFontSize} - 1px); line-height: 1.45; color: #444;
}
.opt.cor {
  background: ${t.correctBg}; color: ${t.correctText};
  font-weight: 700;
  border: 1px solid ${t.correctText}40;
}
.ol {
  font-weight: 800;
  min-width: 16px; height: 16px;
  background: ${isMinimal ? "#e5e5e5" : t.primary + "22"};
  color: ${t.primary};
  border-radius: 3px;
  display: flex; align-items: center; justify-content: center;
  font-size: 8px; flex-shrink: 0;
  font-family: Arial, sans-serif;
  margin-top: 1px;
}
.opt.cor .ol { background: ${t.correctText}; color: #fff; }
.ot { flex: 1; }
.chk { margin-left: auto; flex-shrink: 0; font-size: 11px; color: ${t.correctText}; }
.expl {
  margin-top: 7px; padding: 5px 8px;
  background: ${t.expBg}; color: ${t.expText};
  font-size: calc(${baseFontSize} - 2px); border-radius: 4px; line-height: 1.45;
  border-left: 3px solid ${t.expText}80;
}
.ftr {
  margin-top: 16px; padding-top: 8px;
  border-top: 1px solid #e5e5e5;
  display: flex; justify-content: space-between; align-items: center;
  font-size: 8.5px; color: #bbb;
  font-family: Arial, sans-serif;
  position: relative; z-index: 1;
}
</style>
</head>
<body>
<div class="page">
  ${opts.watermarkText ? `<div class="wm">${escH(opts.watermarkText)}</div>` : ""}
  <div class="hdr">
    <span>${escH(opts.headerLeft || "Quiz Generator")}</span>
    <span>${escH(opts.headerRight || "")}</span>
  </div>
  <div class="ttl">${escH(title)}</div>
  <div class="meta">
    <span>📝 ${quiz.questions.length} Questions</span>
    <span>📅 ${date}</span>
    ${quiz.telegramChannel ? `<span>📢 ${escH(quiz.telegramChannel)}</span>` : ""}
    ${sheetLabel ? `<span>📄 ${escH(sheetLabel)}</span>` : ""}
  </div>
  <div class="div"></div>
  ${columnsHTML}
  <div class="ftr">
    <span>${escH(opts.footerLeft || "Generated by Telegram Quiz Generator")}</span>
    <span></span>
  </div>
</div>
</body>
</html>`;
}

async function renderToPDF(html: string, opts: PdfOptions, filename: string): Promise<void> {
  const PAGE_W = 800;
  const SCALE = 2;
  const PAGE_H_MM = 297;
  const PAGE_W_MM = 210;

  // Create a full-screen overlay so html2canvas renders correctly
  const overlay = document.createElement("div");
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background: #f5f5f5; z-index: 99999;
    display: flex; align-items: flex-start; justify-content: center;
    overflow-y: auto;
  `;

  const container = document.createElement("div");
  container.style.cssText = `
    width: ${PAGE_W}px;
    background: #ffffff;
    margin: 0 auto;
    box-shadow: 0 4px 24px rgba(0,0,0,0.12);
  `;
  container.innerHTML = html;
  overlay.appendChild(container);
  document.body.appendChild(overlay);

  try {
    // Wait for fonts to load
    await document.fonts.ready;
    await new Promise((r) => setTimeout(r, 600));

    const totalH = container.scrollHeight;

    const canvas = await html2canvas(container, {
      scale: SCALE,
      width: PAGE_W,
      height: totalH,
      useCORS: true,
      allowTaint: true,
      logging: false,
      backgroundColor: "#ffffff",
      windowWidth: PAGE_W,
    });

    // Slice into A4 pages
    // A4 at 96dpi: 210mm × 297mm = 794px × 1122px
    // At SCALE=2: 1588 × 2244 pixels per page
    const PAGE_H_PX = Math.round((PAGE_W * SCALE * PAGE_H_MM) / PAGE_W_MM);
    const totalPages = Math.ceil(canvas.height / PAGE_H_PX);

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

    for (let p = 0; p < totalPages; p++) {
      if (p > 0) doc.addPage();

      const startY = p * PAGE_H_PX;
      const sliceH = Math.min(PAGE_H_PX, canvas.height - startY);

      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = canvas.width;
      pageCanvas.height = PAGE_H_PX;
      const ctx = pageCanvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      ctx.drawImage(canvas, 0, startY, canvas.width, sliceH, 0, 0, canvas.width, sliceH);

      const imgData = pageCanvas.toDataURL("image/jpeg", 0.95);
      doc.addImage(imgData, "JPEG", 0, 0, PAGE_W_MM, PAGE_H_MM);

      if (opts.showPageNumbers) {
        doc.setFontSize(8);
        doc.setTextColor(180, 180, 180);
        doc.text(`${p + 1} / ${totalPages}`, PAGE_W_MM - 10, PAGE_H_MM - 5, { align: "right" });
      }
    }

    doc.save(filename);
  } finally {
    document.body.removeChild(overlay);
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
