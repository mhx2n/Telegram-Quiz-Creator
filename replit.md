# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Artifacts

### quiz-generator (React + Vite, preview: `/`)
Telegram Quiz Generator web app. Features:
- AI quiz generation from text or images (Bengali + English OCR via Tesseract.js)
- PDF export using jsPDF (proper Unicode/Bengali support)
- CSV export with 5-option format matching probaho export standard (BOM-encoded UTF-8)
- JSON export with full metadata
- Telegram anonymous quiz posting with progress bar and configurable delay
- Bot token + channel saved in localStorage for convenience
- Individual question editing
- Mobile-friendly with bottom navigation bar
- Drag-and-drop image upload

### api-server (Express 5, preview: `/api`)
REST API backend. Routes:
- `GET /api/quizzes` — list all quizzes
- `GET /api/quizzes/stats` — dashboard statistics
- `POST /api/quizzes` — generate quiz (AI via OpenAI)
- `GET /api/quizzes/:id` — get quiz
- `PUT /api/quizzes/:id` — update quiz title/questions
- `DELETE /api/quizzes/:id` — delete quiz
- `POST /api/quizzes/:id/mark-posted` — mark quiz as posted to Telegram
- `POST /api/quizzes/:id/post-to-telegram` — server-side Telegram posting
- `POST /api/telegram/validate-bot` — validate bot token

## Key Libraries
- `jspdf` — PDF generation with Bengali text support
- `tesseract.js` — browser-based OCR (Bengali + English)
- `drizzle-orm` + PostgreSQL — database
- `@workspace/integrations-openai-ai-server` — AI quiz generation
