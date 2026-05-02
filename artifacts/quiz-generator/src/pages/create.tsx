import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useGenerateQuiz } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListQuizzesQueryKey, getGetQuizStatsQueryKey } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { BrainCircuit, Upload, X, Loader2, ImageIcon } from "lucide-react";

export default function CreateQuiz() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [questionCount, setQuestionCount] = useState(5);
  const [language, setLanguage] = useState("Bengali");
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const generateQuiz = useGenerateQuiz();

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setImagePreview(dataUrl);
      const base64 = dataUrl.split(",")[1];
      setImageBase64(base64);
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveImage = () => {
    setImageBase64(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) {
      toast({ title: "Content required", description: "Please enter content to generate a quiz from.", variant: "destructive" });
      return;
    }
    generateQuiz.mutate(
      { content: content.trim(), title: title.trim() || undefined, imageBase64: imageBase64 || undefined, questionCount, language },
      {
        onSuccess: (quiz) => {
          queryClient.invalidateQueries({ queryKey: getListQuizzesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetQuizStatsQueryKey() });
          toast({ title: "Quiz generated!", description: `${quiz.questionCount} questions created successfully.` });
          setLocation(`/quiz/${quiz.id}`);
        },
        onError: () => {
          toast({ title: "Generation failed", description: "Could not generate quiz. Please try again.", variant: "destructive" });
        },
      }
    );
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Create Quiz</h1>
        <p className="text-muted-foreground mt-1">Paste your content or upload an image — AI will generate quiz questions.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Content</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Quiz Title (optional)</Label>
              <Input
                id="title"
                data-testid="input-title"
                placeholder="e.g. Bangladesh History Quiz"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="content">Source Content</Label>
              <Textarea
                id="content"
                data-testid="textarea-content"
                placeholder="Paste your text, article, lesson content, or notes here..."
                className="min-h-[200px] font-mono text-sm"
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{content.length} characters</p>
            </div>

            <div className="space-y-2">
              <Label>Image (optional)</Label>
              {imagePreview ? (
                <div className="relative w-full max-w-sm">
                  <img src={imagePreview} alt="Preview" className="w-full h-48 object-cover rounded-lg border" />
                  <button
                    type="button"
                    onClick={handleRemoveImage}
                    className="absolute top-2 right-2 bg-background/80 backdrop-blur rounded-full p-1 hover:bg-destructive hover:text-destructive-foreground transition-colors"
                    data-testid="button-remove-image"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed rounded-lg p-8 flex flex-col items-center justify-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors text-muted-foreground"
                  data-testid="dropzone-image"
                >
                  <ImageIcon className="w-8 h-8 mb-2 opacity-40" />
                  <span className="text-sm font-medium">Click to upload image</span>
                  <span className="text-xs mt-1">PNG, JPG, WEBP supported</span>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageUpload}
                data-testid="input-image-file"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Number of Questions</Label>
                <span className="text-2xl font-bold text-primary">{questionCount}</span>
              </div>
              <Slider
                min={1}
                max={50}
                step={1}
                value={[questionCount]}
                onValueChange={([v]) => setQuestionCount(v)}
                data-testid="slider-question-count"
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>1</span>
                <span>25</span>
                <span>50</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="language">Quiz Language</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger id="language" data-testid="select-language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Bengali">Bengali (বাংলা)</SelectItem>
                  <SelectItem value="English">English</SelectItem>
                  <SelectItem value="Bengali and English">Bengali + English (Mixed)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={generateQuiz.isPending || !content.trim()}
          data-testid="button-generate-quiz"
        >
          {generateQuiz.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Generating quiz... (this may take a moment)
            </>
          ) : (
            <>
              <BrainCircuit className="w-4 h-4 mr-2" />
              Generate Quiz
            </>
          )}
        </Button>
      </form>
    </div>
  );
}
