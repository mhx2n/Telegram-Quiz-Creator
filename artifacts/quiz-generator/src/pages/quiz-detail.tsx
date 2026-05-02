import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import {
  useGetQuiz,
  useUpdateQuiz,
  useDeleteQuiz,
  useValidateTelegramBot,
  getGetQuizQueryKey,
  getListQuizzesQueryKey,
  getGetQuizStatsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from "date-fns";
import {
  ArrowLeft, Send, Download, Trash2, Check, X, Edit2, Loader2, FileText, FileJson,
  ChevronDown, ChevronUp, Bot, Hash, Clock, AlertCircle, Pencil, Save
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
import { exportQuizAsPDF } from "@/lib/pdf-export";
import { exportQuizAsCSV, exportQuizAsJSON } from "@/lib/csv-export";

interface QuizQuestion {
  question: string;
  options: string[];
  correctOptionIndex: number;
  explanation?: string;
}

const TG_STORAGE_KEY = "tg_settings";

function loadTgSettings() {
  try {
    const raw = localStorage.getItem(TG_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as { botToken: string; channelId: string; questionPrefix: string; explanationSuffix: string };
  } catch {}
  return { botToken: "", channelId: "", questionPrefix: "", explanationSuffix: "" };
}

function saveTgSettings(botToken: string, channelId: string, questionPrefix: string, explanationSuffix: string) {
  try {
    localStorage.setItem(TG_STORAGE_KEY, JSON.stringify({ botToken, channelId, questionPrefix, explanationSuffix }));
  } catch {}
}

export default function QuizDetail() {
  const { id } = useParams<{ id: string }>();
  const numId = parseInt(id ?? "0", 10);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const savedTg = loadTgSettings();
  const [showTelegramDialog, setShowTelegramDialog] = useState(false);
  const [botToken, setBotToken] = useState(savedTg.botToken);
  const [channelId, setChannelId] = useState(savedTg.channelId);
  const [questionPrefix, setQuestionPrefix] = useState(savedTg.questionPrefix ?? "");
  const [explanationSuffix, setExplanationSuffix] = useState(savedTg.explanationSuffix ?? "");
  const [botValid, setBotValid] = useState<null | { valid: boolean; username?: string | null }>(null);
  const [postDelay, setPostDelay] = useState(2);
  const [postProgress, setPostProgress] = useState(0);
  const [postingStatus, setPostingStatus] = useState("");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [expandedQ, setExpandedQ] = useState<number | null>(null);
  const [editingQ, setEditingQ] = useState<number | null>(null);
  const [draftQuestion, setDraftQuestion] = useState("");
  const [draftOptions, setDraftOptions] = useState<string[]>([]);
  const [draftCorrect, setDraftCorrect] = useState(0);
  const [draftExplanation, setDraftExplanation] = useState("");

  const { data: quiz, isLoading } = useGetQuiz(numId, {
    query: { enabled: !!numId, queryKey: getGetQuizQueryKey(numId) },
  });

  const updateQuiz = useUpdateQuiz();
  const deleteQuiz = useDeleteQuiz();
  const validateBot = useValidateTelegramBot();

  useEffect(() => {
    saveTgSettings(botToken, channelId, questionPrefix, explanationSuffix);
  }, [botToken, channelId, questionPrefix, explanationSuffix]);

  const handleExportPDF = () => {
    if (!quiz) return;
    try {
      exportQuizAsPDF({
        title: quiz.title,
        questions: quiz.questions as QuizQuestion[],
        createdAt: quiz.createdAt,
        telegramChannel: quiz.telegramChannel,
      });
      toast({ title: "PDF downloaded successfully" });
    } catch {
      toast({ title: "PDF export failed", variant: "destructive" });
    }
  };

  const handleExportCSV = () => {
    if (!quiz) return;
    try {
      exportQuizAsCSV({ title: quiz.title, questions: quiz.questions as QuizQuestion[] });
      toast({ title: "CSV downloaded successfully" });
    } catch {
      toast({ title: "CSV export failed", variant: "destructive" });
    }
  };

  const handleExportJSON = () => {
    if (!quiz) return;
    try {
      exportQuizAsJSON({
        id: quiz.id,
        title: quiz.title,
        questions: quiz.questions as QuizQuestion[],
        createdAt: quiz.createdAt,
        telegramChannel: quiz.telegramChannel,
      });
      toast({ title: "JSON downloaded successfully" });
    } catch {
      toast({ title: "JSON export failed", variant: "destructive" });
    }
  };

  const handleValidateBot = () => {
    if (!botToken.trim()) {
      toast({ title: "Bot token required", variant: "destructive" });
      return;
    }
    validateBot.mutate({ data: { botToken } }, {
      onSuccess: (data) => {
        setBotValid(data);
        if (data.valid) {
          toast({ title: `Bot verified: @${data.username}` });
        } else {
          toast({ title: "Invalid bot token", variant: "destructive" });
        }
      },
      onError: () => {
        toast({ title: "Verification failed — check your token", variant: "destructive" });
      },
    });
  };

  const handlePostToTelegram = async () => {
    if (!botToken.trim() || !channelId.trim()) {
      toast({ title: "Bot token and channel ID required", variant: "destructive" });
      return;
    }
    const questions = quiz?.questions as QuizQuestion[];
    if (!questions?.length) return;

    saveTgSettings(botToken, channelId, questionPrefix, explanationSuffix);
    setPostProgress(0);
    setPostingStatus("Starting...");

    try {
      let postedCount = 0;
      for (let i = 0; i < questions.length; i++) {
        setPostingStatus(`Posting question ${i + 1} of ${questions.length}...`);

        const rawQuestion = `${questionPrefix}${questions[i].question}`;
        const rawExplanation = questions[i].explanation
          ? `${questions[i].explanation}${explanationSuffix}`
          : undefined;

        const payload = {
          chat_id: channelId,
          question: rawQuestion.slice(0, 300),
          options: questions[i].options.map((o) => o.slice(0, 100)),
          type: "quiz",
          correct_option_id: questions[i].correctOptionIndex,
          explanation: rawExplanation?.slice(0, 200),
          is_anonymous: true,
        };

        const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendPoll`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await resp.json() as { ok: boolean; description?: string };

        if (!data.ok) {
          toast({
            title: `Failed at question ${i + 1}`,
            description: data.description ?? "Telegram API error",
            variant: "destructive",
          });
          setPostProgress(0);
          setPostingStatus("");
          return;
        }

        postedCount++;
        setPostProgress(Math.round((postedCount / questions.length) * 100));

        if (i < questions.length - 1 && postDelay > 0) {
          setPostingStatus(`Waiting ${postDelay}s before next question...`);
          await new Promise((r) => setTimeout(r, postDelay * 1000));
        }
      }

      await fetch(`/api/quizzes/${numId}/mark-posted`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId }),
      });

      queryClient.invalidateQueries({ queryKey: getGetQuizQueryKey(numId) });
      queryClient.invalidateQueries({ queryKey: getListQuizzesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetQuizStatsQueryKey() });

      toast({ title: "Posted!", description: `${postedCount} questions posted to Telegram.` });
      setShowTelegramDialog(false);
      setPostProgress(0);
      setPostingStatus("");
    } catch (err) {
      toast({ title: "Network error", description: "Could not reach Telegram. Check your connection.", variant: "destructive" });
      setPostProgress(0);
      setPostingStatus("");
    }
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
      onError: () => {
        toast({ title: "Failed to update title", variant: "destructive" });
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
      onError: () => {
        toast({ title: "Failed to delete", variant: "destructive" });
      },
    });
  };

  const startEditQuestion = (i: number, q: QuizQuestion) => {
    setEditingQ(i);
    setDraftQuestion(q.question);
    setDraftOptions([...q.options]);
    setDraftCorrect(q.correctOptionIndex);
    setDraftExplanation(q.explanation ?? "");
    setExpandedQ(i);
  };

  const handleSaveQuestion = () => {
    if (!quiz || editingQ == null) return;
    const questions = (quiz.questions as QuizQuestion[]).map((q, i) =>
      i === editingQ
        ? { ...q, question: draftQuestion, options: draftOptions, correctOptionIndex: draftCorrect, explanation: draftExplanation }
        : q
    );
    updateQuiz.mutate({ id: numId, data: { questions } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetQuizQueryKey(numId) });
        setEditingQ(null);
        toast({ title: "Question updated" });
      },
      onError: () => {
        toast({ title: "Failed to update question", variant: "destructive" });
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
        <AlertCircle className="w-12 h-12 text-muted-foreground mb-4" />
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
          <Button variant="outline" size="sm" onClick={handleExportCSV} data-testid="button-export-csv">
            <FileText className="w-4 h-4 mr-1" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportJSON} data-testid="button-export-json">
            <FileJson className="w-4 h-4 mr-1" /> JSON
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportPDF} data-testid="button-export-pdf">
            <Download className="w-4 h-4 mr-1" /> PDF
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
                <div className="flex items-center gap-1 shrink-0 mt-0.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); startEditQuestion(i, q); }}
                    className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                    title="Edit question"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-muted-foreground">
                    {expandedQ === i ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </span>
                </div>
              </div>
            </CardHeader>

            {expandedQ === i && (
              <CardContent className="pt-0 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                {editingQ === i ? (
                  <div className="space-y-3 border rounded-lg p-4 bg-muted/20">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">Question</Label>
                      <Input
                        value={draftQuestion}
                        onChange={(e) => setDraftQuestion(e.target.value)}
                        className="text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">Options (mark correct with button)</Label>
                      {draftOptions.map((opt, j) => (
                        <div key={j} className="flex gap-2 items-center">
                          <button
                            onClick={() => setDraftCorrect(j)}
                            className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 border-2 transition-colors ${
                              draftCorrect === j ? "bg-emerald-500 text-white border-emerald-500" : "border-muted-foreground text-muted-foreground hover:border-emerald-400"
                            }`}
                          >
                            {String.fromCharCode(65 + j)}
                          </button>
                          <Input
                            value={opt}
                            onChange={(e) => {
                              const updated = [...draftOptions];
                              updated[j] = e.target.value;
                              setDraftOptions(updated);
                            }}
                            className="text-sm"
                          />
                        </div>
                      ))}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">Explanation (optional)</Label>
                      <Input
                        value={draftExplanation}
                        onChange={(e) => setDraftExplanation(e.target.value)}
                        placeholder="Add explanation..."
                        className="text-sm"
                      />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" onClick={handleSaveQuestion} disabled={updateQuiz.isPending}>
                        {updateQuiz.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />}
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingQ(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <>
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
                      <div className="border-l-2 border-primary/40 pl-3 text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">Explanation: </span>
                        {q.explanation}
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            )}
          </Card>
        ))}
      </div>

      {/* Telegram Dialog */}
      <Dialog open={showTelegramDialog} onOpenChange={(open) => { setShowTelegramDialog(open); if (!open) { setPostProgress(0); setPostingStatus(""); } }}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-telegram">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="w-4 h-4 text-[#0088cc]" /> Post to Telegram
            </DialogTitle>
          </DialogHeader>
          <Tabs defaultValue="settings">
            <TabsList className="w-full">
              <TabsTrigger value="settings" className="flex-1">Bot Settings</TabsTrigger>
              <TabsTrigger value="options" className="flex-1">Post Options</TabsTrigger>
            </TabsList>
            <TabsContent value="settings" className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="bot-token" className="flex items-center gap-1.5">
                  <Bot className="w-3.5 h-3.5" /> Bot Token
                </Label>
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
                  <p className={`text-xs flex items-center gap-1 ${botValid.valid ? "text-emerald-600" : "text-destructive"}`}>
                    {botValid.valid ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                    {botValid.valid ? `Valid bot: @${botValid.username}` : "Invalid token — please re-check"}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">Get your token from @BotFather on Telegram.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="channel-id" className="flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5" /> Channel ID or Username
                </Label>
                <Input
                  id="channel-id"
                  placeholder="@mychannel or -1001234567890"
                  value={channelId}
                  onChange={(e) => setChannelId(e.target.value)}
                  data-testid="input-channel-id"
                />
                <p className="text-xs text-muted-foreground">
                  Public channels: @channelname. Private channels: add the bot as admin, then use numeric ID.
                </p>
              </div>
            </TabsContent>
            <TabsContent value="options" className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" /> Delay between questions (seconds)
                </Label>
                <div className="flex items-center gap-3">
                  <Input
                    type="number"
                    min={0}
                    max={60}
                    value={postDelay}
                    onChange={(e) => setPostDelay(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-24"
                  />
                  <span className="text-sm text-muted-foreground">Recommended: 1-3s to avoid rate limits</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded text-xs font-mono">A</span>
                  Question Prefix
                  <span className="text-muted-foreground font-normal">(question-এর আগে যোগ হবে)</span>
                </Label>
                <Input
                  placeholder='যেমন: ★  বা  "Q."  বা  "প্র."'
                  value={questionPrefix}
                  onChange={(e) => setQuestionPrefix(e.target.value)}
                  className="text-sm"
                  maxLength={20}
                />
                {questionPrefix && (
                  <p className="text-xs text-muted-foreground bg-muted/40 rounded px-2 py-1 font-mono truncate">
                    Preview: <span className="text-foreground">{questionPrefix}</span>প্রশ্নের টেক্সট...
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded text-xs font-mono">Z</span>
                  Explanation Suffix
                  <span className="text-muted-foreground font-normal">(explanation-এর পরে যোগ হবে)</span>
                </Label>
                <Input
                  placeholder='যেমন: " — HSC 2024"  বা  " [তথ্যসূত্র: বই]"'
                  value={explanationSuffix}
                  onChange={(e) => setExplanationSuffix(e.target.value)}
                  className="text-sm"
                  maxLength={50}
                />
                {explanationSuffix && (
                  <p className="text-xs text-muted-foreground bg-muted/40 rounded px-2 py-1 font-mono truncate">
                    Preview: ব্যাখ্যার টেক্সট...<span className="text-foreground">{explanationSuffix}</span>
                  </p>
                )}
              </div>

              <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-1">
                <div className="font-medium">Will post:</div>
                <div className="text-muted-foreground">{questions.length} questions as anonymous Telegram quiz polls</div>
                <div className="text-muted-foreground">Total time: ~{Math.round(questions.length * (postDelay + 1))}s</div>
              </div>
            </TabsContent>
          </Tabs>

          {postProgress > 0 && (
            <div className="space-y-2 pt-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{postingStatus}</span>
                <span>{postProgress}%</span>
              </div>
              <Progress value={postProgress} className="h-2" />
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowTelegramDialog(false); setPostProgress(0); setPostingStatus(""); }}>
              Cancel
            </Button>
            <Button
              onClick={handlePostToTelegram}
              disabled={!botToken || !channelId || postProgress > 0}
              data-testid="button-confirm-post"
            >
              {postProgress > 0 ? (
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
