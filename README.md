# NEC Tutor

A working academic workspace for Programming, Chemistry, English, Basic Civil and Mechanical Engineering, Java, Advanced Data Structures and Algorithms, Digital Logic and Computer Organization, and Universal Human Values. It includes tutoring with page references, persistent student memory, a searchable library, student support tickets, staff replies, and a clearly labelled demo examination timetable.

## Run locally

Open a terminal in `C:\NEC Tutor`:

```powershell
npm install
npm run import:materials -- --ocr
npm run dev
```

Open http://127.0.0.1:3000. This installation is configured in **live** mode with Supabase and Gemini. A fresh installation can use `NEC_MODE=preview` to search actual extracted notes and return excerpts before connecting accounts. Preview profiles, chats and tickets persist locally in `.data/preview.json`; it is restricted to localhost.

Original files in `Subject Pdfs` are preserved. Chemistry units 1, 3 and 4 contain scanned pages; the importer uses English OCR for them. OCR can misread symbols, formulas and diagrams: open cited pages to inspect these. The first OCR run downloads its language data and caches it inside `.data/ocr`. Text and OCR extraction are cached in `.data/catalog.json`.

## Connect your accounts

1. Fill `.env.local` with `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (or legacy anon key), `SUPABASE_SECRET_KEY` (or legacy service_role key), and `GEMINI_API_KEY`. These remain local and are ignored by Git. Never put the secret or Gemini key in a `NEXT_PUBLIC_` variable.
2. In your Supabase project's SQL Editor, execute the complete `supabase/schema.sql`. It creates the data tables, access policies, vector search functions, and private `materials` storage bucket. Use a project dedicated to NEC Tutor.
3. Verify the connections:

```powershell
npm run check:connections
```

4. Build the local search index and upload the prepared materials to Supabase:

```powershell
npm run import:materials -- --ocr --live
```

The command stores PDFs and extracted passages in your private Supabase project. It downloads the MPNet search model from Hugging Face once, then computes document embeddings on your computer. No PDFs or indexing passages are sent to Gemini or Hugging Face. Model files and embeddings are cached in `.data/models` and `.data/local-embedding-cache.json`; repeating an import reuses unchanged embeddings. Each document index is replaced in a database transaction. A failed transaction does not leave half an index.

5. Set `NEC_MODE=live` and restart the server. Sign up in the application with a name, email and password. The app's server creates a confirmed student account, then signs it in immediately; no email verification is required. Supabase still validates the password and session on every protected request. Configure Supabase Auth's Site URL to `http://127.0.0.1:3000` for local use.
6. Create a staff account through the same sign-up form, then run this in the Supabase SQL Editor, replacing the example email:

```sql
update public.profiles set role='admin'
where id=(select id from auth.users where email='YOUR_STAFF_EMAIL');
```

Student sign-up cannot assign staff privileges. Staff can upload/remove documents, import locally prepared documents, and respond to tickets. Students only see their own memory, conversations and tickets. In live mode the server verifies Supabase sessions and database policies enforce ownership. The private document bucket is accessed through short-lived signed URLs after authentication.

Only answer generation uses Gemini. Course questions use local embeddings and Supabase vector retrieval. Administrative questions use keyword retrieval from the shared Academic Documents library, so a course/unit filter does not hide the timetable. Gemini receives up to four retrieved passages, the question, and limited conversation context; full PDFs are never uploaded to Gemini. Every live chat reply uses Gemini to explain with clear steps, examples and citations. Missing or conflicting evidence leads to clarification or staff support. Each answer still uses Gemini's free-tier allowance. The local model, `Xenova/all-mpnet-base-v2`, returns 768 dimensions. Changing it requires rebuilding every document index.

The five supplied Word documents have reflowed PDF study copies beside their originals. Their text and inline figures are retained; cited page numbers refer to the PDF copies. Originals are preserved. The demo timetable contains fictional Internal Assessment I dates from 19 to 22 October 2026, with separate morning and afternoon subject groups. Answers explicitly label these as demo dates and refer students to college staff for real dates.

## Demo accounts

The student demo account uses `demo.student@nec-tutor.example`; the staff demo uses `demo.staff@nec-tutor.example`. Their generated passwords are stored only in ignored `.data/demo-login.json` and `.data/staff-demo-login.json`. Re-running `npx tsx scripts/create-demo-account.ts` or `npx tsx scripts/create-staff-demo.ts` reuses and verifies the saved demo account. Staff can manage materials and reply to student support tickets. New signups always remain students.

## What is implemented

- Subject and unit selection; page-preserving PDF extraction and OCR.
- Local MPNet embeddings, Supabase vector search, and evidence-grounded Gemini responses in live mode.
- Source cards open the supporting PDF at the cited page.
- Server-generated ticket context and source references; tickets are created only when a student submits the form.
- Persistent profile preferences, conversation context, and a memory-clear action.
- Admin document upload, removal and local-library import; removal also removes searchable chunks.
- Responsive student interface, staff workspace, loading/error states and sign-in/sign-up.
- Server-side keys, role enforcement, per-student ownership policies and basic chat rate limiting.

## Verification

```powershell
npm run typecheck
npm test
npm run build
```

Use two student accounts to verify isolation in live mode. Preview account switching demonstrates the same UI flow but is not production authentication. Live database/auth/storage and AI calls need the configured accounts and schema before they can be verified.

## Three-minute hackathon demo

1. Choose Programming, Unit 4. Ask “Explain pointers in C with a simple example.” Open the source PDF at its cited page.
2. Ask “Explain it more simply.” Show the follow-up retains context.
3. Save your department, semester and explanation style in Study memory; refresh to show persistence.
4. Choose Chemistry and ask “What is my exam date?” Show the cited demo date, 20 October 2026, 10 AM to noon. Ask “When is the Java examination?” to show the shared timetable works across subject filters.
5. Sign in as staff (or switch to the explicitly labeled staff preview). Open Support tickets, reply, and mark the ticket resolved. Return as the student and refresh to see the reply.

For the escalation demonstration, ask an unsupported question such as your official exam eligibility, then submit it to staff. Upload real notices under Academic Documents when they become available; the current timetable is fictional demo data.

## Architecture

Browser -> Next.js API -> authenticated student context -> local question embedding -> Supabase vector retrieval -> Gemini grounded answer -> persisted conversation and citations. PDF extraction, OCR and document embedding run locally. Supabase stores the PDFs, passages and vectors. Escalation uses Supabase tickets/replies. Local preview uses deterministic lexical retrieval and a separate JSON store.

Official implementation references: [Next.js backend functions](https://nextjs.org/docs/app/guides/backend-for-frontend), [Supabase database access policies](https://supabase.com/docs/guides/database/postgres/row-level-security), [local search model](https://huggingface.co/Xenova/all-mpnet-base-v2), [Transformers.js model caching](https://huggingface.co/docs/transformers.js/v3.8.1/api/env), [Gemini text generation](https://ai.google.dev/api/generate-content), [PDF extraction](https://github.com/mehmet-kozan/pdf-parse).
