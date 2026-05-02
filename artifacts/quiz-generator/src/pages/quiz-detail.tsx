import { useState } from "react";
import { useParams, useLocation } from "wouter";
import {
  useGetQuiz,
  useUpdateQuiz,
  useDeleteQuiz,
  usePostQuizToTelegram,
  useExportQuiz,
  useValidateTelegramBot,
  getGetQuizQueryKey,
  getListQuizzesQueryKey,
  getExportQuizQueryKey,
  getGetQuizStatsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { format } from "date-fns";
import {
  ArrowLeft, Send, Download, Trash2, Check, X, Edit2, Loader2, FileText, FileJson, FilePdf, ChevronDown, ChevronUp
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface QuizQuestion {
  question: string;
  options: string[];
  correctOptionIndex: number;
  explanation?: string;
}

export default function QuizDetail() {
  const { id } = useParams<{ id: string }>();
  const numId = parseInt(id ?? "0", 10);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [showTelegramDialog, setShowTelegramDialog] = useState(false);
  const [botToken, setBotToken] = useState("");
  const [channelId, setChannelId] = useState("");
  const [botValid, setBotValid] = useState<null | { valid: boolean; username?: string | null }>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [expandedQ, setExpandedQ] = useState<number | null>(null);

  const { data: quiz, isLoading } = useGetQuiz(numId, {
    query: { enabled: !!numId, queryKey: getGetQuizQueryKey(numId) },
  });

  const updateQuiz = useUpdateQuiz();
  const deleteQuiz = useDeleteQuiz();
  const postToTelegram = usePostQuizToTelegram();
  const validateBot = useValidateTelegramBot();

  const exportCsvQuery = useExportQuiz(numId, { format: "csv" }, {
    query: { enabled: false, queryKey: getExportQuizQueryKey(numId, { format: "csv" }) },
  });

  const exportJsonQuery = useExportQuiz(numId, { format: "json" }, {
    query: { enabled: false, queryKey: getExportQuizQueryKey(numId, { format: "json" }) },
  });

  const handleExport = async (format: "csv" | "json") => {
    const result = format === "csv" ? await exportCsvQuery.refetch() : await exportJsonQuery.refetch();
    if (result.data) {
      const { data: content, filename, format: fmt } = result.data;
      const blob = new Blob([content], { type: fmt === "json" ? "application/json" : "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: `Exported as ${fmt.toUpperCase()}` });
    }
  };

  const handleExportPDF = () => {
    if (!quiz) return;
    const questions = quiz.questions as QuizQuestion[];
    const html = `
      <html>
      <head>
        <title>${quiz.title}</title>
        <style>
          body { font-family: 'Segoe UI', sans-serif; max-width: 800px; margin: 40px auto; color: #111; font-size: 14px; }
          h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
          .meta { color: #666; font-size: 12px; margin-bottom: 32px; }
          .question { margin-bottom: 24px; page-break-inside: avoid; }
          .qnum { font-weight: 700; color: #007b6e; }
          .qtext { font-size: 15px; font-weight: 600; margin: 4px 0 8px; }
          .option { padding: 4px 8px; margin: 3px 0; border-radius: 4px; }
          .correct { background: #d1fae5; font-weight: 600; }
          .explanation { margin-top: 8px; color: #555; font-size: 12px; border-left: 3px solid #007b6e; padding-left: 8px; }
        </style>
      </head>
      <body>
        <h1>${quiz.title}</h1>
        <div class="meta">${questions.length} questions • Generated ${format(new Date(quiz.createdAt), "PPP")}</div>
        ${questions.map((q, i) => `
          <div class="question">
            <div class="qnum">Question ${i + 1}</div>
            <div class="qtext">${q.question}</div>
            ${q.options.map((opt, j) => `
              <div class="option ${j === q.correctOptionIndex ? "correct" : ""}">
                ${String.fromCharCode(65 + j)}. ${opt}${j === q.correctOptionIndex ? " ✓" : ""}
              </div>
            `).join("")}
            ${q.explanation ? `<div class="explanation">${q.explanation}</div>` : ""}
          </div>
        `).join("")}
      </body>
      </html>
    `;
    const win = window.open("", "_blank");
    if (win) {
      win.document.write(html);
      win.document.close();
      win.focus();
      setTimeout(() => win.print(), 500);
    }
  };

  const handleValidateBot = () => {
    validateBot.mutate({ botToken }, {
      onSuccess: (data) => {
        setBotValid(data);
        if (data.valid) {
          toast({ title: `Bot verified: @${data.username}` });
        } else {
          toast({ title: "Invalid bot token", variant: "destructive" });
        }
      },
    });
  };

  const handlePostToTelegram = () => {
    postToTelegram.mutate({ id: numId, data: { botToken, channelId } }, {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getGetQuizQueryKey(numId) });
        queryClient.invalidateQueries({ queryKey: getListQuizzesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetQuizStatsQueryKey() });
        toast({ title: "Posted!", description: `${result.postedCount} questions posted to Telegram.` });
        setShowTelegramDialog(false);
        setBotToken("");
        setChannelId("");
        setBotValid(null);
      },
      onError: () => {
        toast({ title: "Failed to post", description: "Check your bot token and channel ID.", variant: "destructive" });
      },
    });
  };

  const handleSaveTitle = () => {
    if (!draftTitle.trim()) return;
    updateQuiz.mutate({ id: numId, data: { title: draftTitle.trim() } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetQuizQueryKey(numId) });
        queryClient.invalidateQueries({ queryKey: getListQuizzesQueryKey() });
        setEditingTitle(false);
        toast({ title: "Title updated" });
      },
    });
  };

  const handleDeleteQuiz = () => {
    deleteQuiz.mutate({ id: numId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListQuizzesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetQuizStatsQueryKey() });
        toast({ title: "Quiz deleted" });
        setLocation("/history");
      },
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!quiz) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <p className="text-lg font-medium">Quiz not found</p>
        <Button className="mt-4" onClick={() => setLocation("/history")}>Back to History</Button>
      </div>
    );
  }

  const questions = quiz.questions as QuizQuestion[];

  return (
    <div className="space-y-6 pb-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => setLocation("/history")} data-testid="button-back">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
        <div className="flex-1">
          {editingTitle ? (
            <div className="flex items-center gap-2">
              <Input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                className="text-xl font-bold h-auto py-1"
                autoFocus
                data-testid="input-edit-title"
                onKeyDown={(e) => e.key === "Enter" && handleSaveTitle()}
              />
              <Button size="sm" onClick={handleSaveTitle} disabled={updateQuiz.isPending} data-testid="button-save-title">
                {updateQuiz.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingTitle(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-bold tracking-tight">{quiz.title}</h1>
              <button
                onClick={() => { setDraftTitle(quiz.title); setEditingTitle(true); }}
                className="text-muted-foreground hover:text-foreground transition-colors"
                data-testid="button-edit-title"
              >
                <Edit2 className="w-4 h-4" />
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <span className="text-muted-foreground text-sm">{questions.length} questions</span>
            <span className="text-muted-foreground text-sm">•</span>
            <span className="text-muted-foreground text-sm">{format(new Date(quiz.createdAt), "PPP")}</span>
            {quiz.postedToTelegram && (
              <Badge variant="secondary" className="bg-[#0088cc]/10 text-[#0088cc] border-0">
                <Send className="w-3 h-3 mr-1" /> Posted to {quiz.telegramChannel ?? "Telegram"}
              </Badge>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => handleExport("csv")} disabled={exportCsvQuery.isFetching} data-testid="button-export-csv">
            {exportCsvQuery.isFetching ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <FileText className="w-4 h-4 mr-1" />}
            CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleExport("json")} disabled={exportJsonQuery.isFetching} data-testid="button-export-json">
            {exportJsonQuery.isFetching ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <FileJson className="w-4 h-4 mr-1" />}
            JSON
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportPDF} data-testid="button-export-pdf">
            <Download className="w-4 h-4 mr-1" />
            PDF
          </Button>
          <Button size="sm" onClick={() => setShowTelegramDialog(true)} data-testid="button-post-telegram">
            <Send className="w-4 h-4 mr-1" />
            Post to Telegram
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:bg-destructive/10"
            onClick={() => setShowDeleteDialog(true)}
            data-testid="button-delete-quiz"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {questions.map((q, i) => (
          <Card key={i} className="overflow-hidden" data-testid={`card-question-${i}`}>
            <CardHeader
              className="pb-3 cursor-pointer hover:bg-muted/30 transition-colors"
              onClick={() => setExpandedQ(expandedQ === i ? null : i)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1">
                  <span className="bg-primary/10 text-primary font-bold text-xs px-2 py-1 rounded shrink-0 mt-0.5">
                    Q{i + 1}
                  </span>
                  <CardTitle className="text-sm font-medium leading-snug">{q.question}</CardTitle>
                </div>
                <span className="text-muted-foreground shrink-0 mt-1">
                  {expandedQ === i ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </span>
              </div>
            </CardHeader>

            {expandedQ === i && (
              <CardContent className="pt-0 space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {q.options.map((opt, j) => (
                    <div
                      key={j}
                      className={`flex items-center gap-2 p-3 rounded-lg text-sm border transition-colors ${
                        j === q.correctOptionIndex
                          ? "bg-emerald-50 border-emerald-200 text-emerald-900 font-medium"
                          : "bg-muted/40 border-transparent"
                      }`}
                    >
                      <span className={`font-bold text-xs w-5 h-5 flex items-center justify-center rounded-full shrink-0 ${
                        j === q.correctOptionIndex ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"
                      }`}>
                        {String.fromCharCode(65 + j)}
                      </span>
                      {opt}
                      {j === q.correctOptionIndex && <Check className="w-3 h-3 ml-auto text-emerald-600" />}
                    </div>
                  ))}
                </div>
                {q.explanation && (
                  <div className="border-l-2 border-primary/40 pl-3 text-sm text-muted-foreground mt-2">
                    <span className="font-medium text-foreground">Explanation: </span>
                    {q.explanation}
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        ))}
      </div>

      {/* Telegram Dialog */}
      <Dialog open={showTelegramDialog} onOpenChange={setShowTelegramDialog}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-telegram">
          <DialogHeader>
            <DialogTitle>Post to Telegram</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="bot-token">Bot Token</Label>
              <div className="flex gap-2">
                <Input
                  id="bot-token"
                  type="password"
                  placeholder="123456789:ABCdefGHI..."
                  value={botToken}
                  onChange={(e) => { setBotToken(e.target.value); setBotValid(null); }}
                  data-testid="input-bot-token"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleValidateBot}
                  disabled={!botToken || validateBot.isPending}
                  data-testid="button-validate-bot"
                >
                  {validateBot.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify"}
                </Button>
              </div>
              {botValid && (
                <p className={`text-xs ${botValid.valid ? "text-emerald-600" : "text-destructive"}`}>
                  {botValid.valid ? `Valid bot: @${botValid.username}` : "Invalid token"}
                </p>
              )}
              <p className="text-xs text-muted-foreground">Get your token from @BotFather on Telegram.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="channel-id">Channel ID or Username</Label>
              <Input
                id="channel-id"
                placeholder="@mychannel or -1001234567890"
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                data-testid="input-channel-id"
              />
              <p className="text-xs text-muted-foreground">
                Use @channelname for public channels. For private channels, add the bot as admin and use the numeric ID.
              </p>
            </div>

            <div className="bg-muted rounded-lg p-3 text-sm text-muted-foreground">
              Will post all {questions.length} questions as Telegram quiz polls.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTelegramDialog(false)}>Cancel</Button>
            <Button
              onClick={handlePostToTelegram}
              disabled={!botToken || !channelId || postToTelegram.isPending}
              data-testid="button-confirm-post"
            >
              {postToTelegram.isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Posting...</>
              ) : (
                <><Send className="w-4 h-4 mr-2" /> Post {questions.length} Questions</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Quiz</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{quiz.title}" and all its questions.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteQuiz}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-quiz"
            >
              {deleteQuiz.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
