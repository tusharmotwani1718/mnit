# Yojana Darshak

A free, voice-first phone line that tells rural citizens which government schemes they qualify for, in Hindi or Marathi, on any phone. The same agent also runs as a web chat in Hindi, Marathi and English.

## Overview

- **Call:** dial the number and speak naturally. The agent asks only what it needs (at most 5 questions per topic), then gives the schemes you qualify for, the documents to carry and where to apply, and sends an SMS checklist if you agree.
- **Web:** a chat with scheme cards, a profile (mobile number + password) that saves your answers with consent, and an application readiness score (0–100) compared with an ideal applicant.
- **Coverage:** 29 schemes with verified eligibility rules (central, Maharashtra, Rajasthan), and 57 schemes it can explain from official documents.
- **Safety:** never asks for Aadhaar, bank details or OTP, and warns callers about agents demanding money.

## Approach

**Rules decide. RAG explains. Every answer points to an official source.**

- **Eligibility is computed, not guessed.** A deterministic rules engine (`data/schemes/*.json`, written from official guidelines) decides who qualifies. It picks the one question that settles the most schemes next.
- **One AI call per turn.** GPT-4.1-mini model to extract the caller's facts and intent only (structured output). Replies are built from templates and verified scheme data, so amounts and documents are never paraphrased by the AI.
- **RAG for questions.** Follow-ups ("when will the money come?") are answered from official PDFs and summaries in Supabase pgvector. Search is hybrid (vectors plus scheme names) and state-aware, and every answer cites its passage.

## Workflow

```
Caller / browser ──► LiveKit ──► Voice worker (Python) ──┐   Gnani speech-to-text / text-to-speech
Web chat ──────────► Next.js web app ────────────────────┤
                                                         ▼
                                  Agent core (Node/TypeScript)
                     1. GPT-4.1-mini extracts facts and intent
                     2. Rules engine evaluates all schemes, picks the next question
                     3. RAG fetches official passages for follow-up questions
                     4. Reply composed from templates, spoken or shown
                     5. At call end: SMS checklist (with consent)
                                                         │
                     Supabase: pgvector passages · profiles
```

| Folder | What it is |
|---|---|
| `core/` | Agent core: rules engine, conversation logic, RAG, readiness score, accounts, SMS (Express API) |
| `voice/` | Voice worker: LiveKit Agents + Gnani, sends each turn to core |
| `web/` | Next.js site: chat, login, profile, readiness page, live call panel (`/live`) |
| `data/` | Scheme rules, fact vocabulary, RAG corpus and evaluation questions |

## Run it

**Needs:** Node.js 22+, [uv](https://docs.astral.sh/uv/) (Python 3.12 is installed by uv), and accounts for OpenAI, Supabase, LiveKit Cloud and Gnani.

### 1. Configure

Copy each example and fill in the values (every variable is described in the file):

```bash
cp core/.env.example core/.env
cp voice/.env.example voice/.env
cp web/.env.example web/.env.local
```

- `core/.env`: `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `AUTH_SECRET` (32+ random characters). SMS is optional: without `SMS_PROVIDER` messages are only printed.
- `voice/.env`: `LIVEKIT_*`, `GNANI_API_KEY`, `CORE_URL=http://localhost:8080`.
- `web/.env.local`: `CORE_URL=http://localhost:8080`, the same `LIVEKIT_*`, `NEXT_PUBLIC_CALL_NUMBER`.
- If you set `CORE_API_KEY` or `LIVE_VIEW_TOKEN` in core, set the same values in voice and web.

### 2. Database (once)

In Supabase → **SQL Editor**, run `core/db/rag.sql` and then `core/db/app.sql`.

### 3. Core

```bash
cd core
npm install
npm run rag:ingest     # embed the documents into Supabase (re-run when data/ changes)
npm run dev            # http://localhost:8080
```

### 4. Voice worker

```bash
cd voice
uv sync
uv run agent.py dev        # phone and browser calls via LiveKit
# uv run agent.py console  # quick test with your laptop mic
```

For the phone line, point a LiveKit phone number's dispatch rule at the agent name in `AGENT_NAME` (default `yojana`).

### 5. Web

```bash
cd web
npm install
npm run dev            # http://localhost:3000 (citizen site), /live (live call panel)
```

Start in this order: **core → voice → web**.

### Useful commands

| Command (in `core/`) | What it does |
|---|---|
| `npm test` | Run the test suite |
| `npm run chat -- en` | Text chat with the agent in the terminal (`hi`, `mr` or `en`) |
| `npm run rag:eval` | Retrieval accuracy on `data/corpus/eval.json` |

Design details: [`specs/product.md`](specs/product.md).
