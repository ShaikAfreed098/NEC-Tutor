import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { db } from "../src/lib/auth";
import { readCatalog, DATA_DIR } from "../src/lib/local-store";
import { EMBEDDING_VERSION, embedTexts } from "../src/lib/embeddings";
import type { Profile, Conversation, Ticket } from "../src/lib/types";
import { configuration } from "../src/lib/config";

// Explicit integration verification: creates isolated synthetic accounts,
// sends two answer requests, then removes only this run's test data.
const origin = "http://127.0.0.1:3000";
const service = db(undefined, true);
const userIds: string[] = [], ticketIds: string[] = [];
const checks: string[] = [];
function passed(text: string) { checks.push(text); console.log(`PASS: ${text}`); }
function checked(error: { message: string } | null) { if (error) throw new Error(error.message); }
async function api<T>(endpoint: string, token?: string, method = "GET", body?: unknown, status = 200): Promise<T> {
  const response = await fetch(`${origin}/api/${endpoint}`, { method,
    headers: { Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const value = await response.json();
  assert.equal(response.status, status, `Unexpected status for ${method} ${endpoint}: ${value.error || "request failed"}`);
  return value as T;
}
async function account(label: string) {
  const email = `nec-tutor-check-${crypto.randomUUID()}@example.com`;
  const password = crypto.randomUUID() + "aA!9";
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: label, role: "admin" } });
  checked(created.error); assert.ok(created.data.user); userIds.push(created.data.user.id);
  const signedIn = await db().auth.signInWithPassword({ email, password });
  checked(signedIn.error); assert.ok(signedIn.data.session);
  return { id: created.data.user.id, token: signedIn.data.session.access_token };
}

async function main() {
  const settings = await api<{ mode: string; ready: boolean }>("config");
  assert.equal(settings.mode, "live"); assert.ok(settings.ready);
  const catalog = await readCatalog();
  const remote = await service.from("documents").select("*"); checked(remote.error);
  const cache = JSON.parse(await fs.readFile(path.join(DATA_DIR, "local-embedding-cache.json"), "utf8")) as Record<string, number[]>;
  let pages = 0, passages = 0;
  const skipMaterials = process.argv.includes("--skip-materials");
  if (skipMaterials) {
    const verified = JSON.parse(await fs.readFile(path.join(DATA_DIR, "materials-verification.json"), "utf8"));
    assert.equal(verified.documents, catalog.documents.length); assert.equal(verified.passages, catalog.chunks.length);
    pages = verified.pages; passages = verified.passages;
  }
  for (const local of skipMaterials ? [] : catalog.documents) {
    const document = remote.data!.find(d => d.id === local.id); assert.ok(document, `Missing ${local.title}`);
    assert.equal(document.chunk_count, local.chunks); assert.equal(document.pages, local.pages);
    const rows = await service.from("document_chunks").select("id", { count: "exact", head: true }).eq("document_id", local.id);
    checked(rows.error); assert.equal(rows.count, local.chunks);
    const sample = await service.from("document_chunks").select("content,embedding").eq("document_id", local.id).order("id").limit(1).single(); checked(sample.error);
    const key = createHash("sha256").update(`${EMBEDDING_VERSION}:${sample.data!.content}`).digest("hex");
    const expected = cache[key]; assert.ok(expected, `${local.title} must use local embeddings`);
    const actual = typeof sample.data!.embedding === "string" ? JSON.parse(sample.data!.embedding) as number[] : sample.data!.embedding as number[];
    assert.equal(actual.length, 768); assert.ok(actual.every((v, i) => Math.abs(v - expected[i]) < 0.000001));
    const downloaded = await service.storage.from("materials").download(document.storage_path); checked(downloaded.error);
    const bytes = Buffer.from(await downloaded.data!.arrayBuffer());
    assert.equal(createHash("sha256").update(bytes).digest("hex"), createHash("sha256").update(await fs.readFile(local.filePath!)).digest("hex"));
    pages += local.pages; passages += local.chunks;
  }
  passed(`${catalog.documents.length} private PDFs verified byte-for-byte; ${pages} pages and ${passages} locally indexed passages`);
  const bucket = await service.storage.getBucket("materials"); checked(bucket.error); assert.equal(bucket.data!.public, false);
  const student = await account("Verification student"), second = await account("Second verification student"), staff = await account("Verification staff");
  const profile = await api<Profile>("profile", student.token); assert.equal(profile.role, "student");
  const promoted = await service.from("profiles").update({ role: "admin" }).eq("id", staff.id); checked(promoted.error);
  const deniedPromotion = await db(student.token).from("profiles").update({ role: "admin" }).eq("id", student.id); assert.ok(deniedPromotion.error);
  await api("documents", undefined, "GET", undefined, 401);
  await api("admin/local-documents", student.token, "GET", undefined, 403);
  passed("Real sign-in, private storage, student-only signup, and staff route protection");
  const memory = { name: profile.name, department: "Verification department", semester: "1", preferredStyle: "simple", subjects: ["programming"] };
  await api("profile", student.token, "PATCH", memory);
  const saved = await api<Profile>("profile", student.token); assert.equal(saved.department, memory.department);
  assert.notEqual((await api<Profile>("profile", second.token)).department, memory.department);
  passed("Saved study memory persists and is private to its student");
  const [vector] = await embedTexts(["Explain pointers in C with a simple example."]);
  const matches = await db(student.token).rpc("match_course_chunks", { query_embedding: vector, selected_subject: "programming", selected_unit: 4, match_limit: 4 });
  checked(matches.error); assert.ok(matches.data?.length); assert.ok(matches.data.every((m: {subject: string; unit: number; content: string}) => m.subject === "programming" && m.unit === 4));
  passed("A locally embedded question retrieves Programming Unit 4 through authenticated Supabase vector search");
  const reply = await api<{ conversationId: string; message: { content: string; sources: {subject: string; reference: number}[]; needsEscalation: boolean } }>("chat", student.token, "POST", { question: "Explain pointers in C with a simple example.", subject: "programming", unit: 4, conversationId: null });
  assert.ok(reply.message.sources.length); assert.ok(reply.message.sources.every(s => s.subject === "programming" && reply.message.content.includes(`[${s.reference}]`)));
  assert.equal(reply.message.needsEscalation, false);
  await fs.writeFile(path.join(DATA_DIR, "gemini-answer-check.md"), reply.message.content);
  passed("One Gemini generation produces a grounded answer with matching PDF page citations");
  assert.ok((await api<Conversation[]>("conversations", student.token)).some(c => c.id === reply.conversationId));
  assert.ok(!(await api<Conversation[]>("conversations", second.token)).some(c => c.id === reply.conversationId));
  const isolated = await db(second.token).from("conversations").select("id").eq("id", reply.conversationId); checked(isolated.error); assert.equal(isolated.data!.length, 0);
  const otherMessages = await db(second.token).from("messages").select("id").eq("conversation_id", reply.conversationId); checked(otherMessages.error); assert.equal(otherMessages.data!.length, 0);
  passed("Conversation and message ownership is enforced by the app and database policies");
  const unknown = await api<{ conversationId: string; message: { sources: unknown[]; needsEscalation: boolean } }>("chat", student.token, "POST", { question: "Am I eligible to sit my final examinations with 62 percent attendance?", subject: "all", unit: null, conversationId: null });
  assert.equal(unknown.message.sources.length, 0); assert.equal(unknown.message.needsEscalation, true);
  const ticket = await api<Ticket>("tickets", student.token, "POST", { question: "Am I eligible to sit my final examinations with 62 percent attendance?", conversationId: unknown.conversationId }, 201); ticketIds.push(ticket.id);
  assert.ok(!(await api<Ticket[]>("tickets", second.token)).some(t => t.id === ticket.id));
  await api(`tickets/${ticket.id}/replies`, second.token, "POST", { content: "Unauthorized reply" }, 403);
  await api(`tickets/${ticket.id}/replies`, staff.token, "POST", { content: "Verification response: please consult the official college timetable." }, 201);
  await api(`tickets/${ticket.id}`, staff.token, "PATCH", { status: "resolved" });
  const resolved = (await api<Ticket[]>("tickets", student.token)).find(t => t.id === ticket.id); assert.equal(resolved?.status, "resolved"); assert.equal(resolved?.replies.length, 1);
  passed("Gemini explains missing timetable evidence; private escalation, staff reply, and resolution work");
  await fs.writeFile(path.join(DATA_DIR, "verification.json"), JSON.stringify({ verifiedAt: new Date().toISOString(), embeddingModel: EMBEDDING_VERSION, documents: catalog.documents.length, pages, passages, answerExample: reply.message.content, checks }, null, 2));
}

try { await main(); }
catch (error) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of [configuration().geminiKey, configuration().secretKey]) if (secret) message = message.replaceAll(secret, "[redacted]");
  console.error(`Verification failed: ${message}`); process.exitCode = 1;
}
finally {
  if (ticketIds.length) { const removed = await service.from("tickets").delete().in("id", ticketIds); checked(removed.error); }
  for (const id of userIds.reverse()) { const removed = await service.auth.admin.deleteUser(id); checked(removed.error); }
  if (userIds.length) console.log("Temporary verification accounts and their records removed.");
}
