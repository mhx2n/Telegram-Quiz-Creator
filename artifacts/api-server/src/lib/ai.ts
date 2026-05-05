import { openai } from "@workspace/integrations-openai-ai-server";

export const aiClient = openai;
export const AI_MODEL = "gpt-4o-mini";
export const AI_SUPPORTS_VISION = true;

export type AIMessage = {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: string; [key: string]: unknown }>;
};
