import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { configuration } from "../src/lib/config";
import { db } from "../src/lib/auth";
import { embedTexts, EMBEDDING_MODEL } from "../src/lib/embeddings";
const settings = configuration();
if (settings.missing.length) { console.error(`Missing settings: ${settings.missing.join(", ")}. Fill .env.local first.`); process.exit(1); }
const result = await db(undefined, true).from("documents").select("id,title,subject,pages,storage_path", { count: "exact" }).limit(1);
if (result.error) throw new Error(`Supabase check failed: ${result.error.message}. Run supabase/schema.sql.`);
console.log(`Supabase connected. ${result.count || 0} documents indexed.`);
await embedTexts(["C programming arrays"]);
console.log(`Local search ready: ${EMBEDDING_MODEL} (768 dimensions). No Gemini embedding call.`);
const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${settings.chatModel}`, { headers: { "x-goog-api-key": settings.geminiKey } });
if (!response.ok) throw new Error(`Chat model check failed (${response.status}). Set GEMINI_CHAT_MODEL to an available model.`);
console.log(`Chat model available: ${settings.chatModel}. Credentials were not printed.`);
