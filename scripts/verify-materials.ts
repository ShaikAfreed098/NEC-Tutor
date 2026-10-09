import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { db } from "../src/lib/auth";
import { readCatalog, DATA_DIR } from "../src/lib/local-store";
import { EMBEDDING_VERSION, embedTexts } from "../src/lib/embeddings";
import { configuration } from "../src/lib/config";
import type { DocumentRecord } from "../src/lib/types";
type StoredDocument = { id: string; chunk_count: number; pages: number; storage_path: string };

// Read-only verification of Supabase. No auth changes or Gemini requests.
async function main() {
  const client = db(undefined, true), catalog = await readCatalog();
  const documents = await client.from("documents").select("*");
  if (documents.error) throw documents.error;
  const storedDocuments = documents.data || [];
  const cache = JSON.parse(await fs.readFile(path.join(DATA_DIR, "local-embedding-cache.json"), "utf8")) as Record<string, number[]>;
  let pages = 0, passages = 0;
  async function verifyOne(local: DocumentRecord) {
    const remote: StoredDocument | undefined = storedDocuments.find((d: StoredDocument) => d.id === local.id); assert.ok(remote, `Missing ${local.title}`);
    assert.equal(remote.chunk_count, local.chunks); assert.equal(remote.pages, local.pages);
    const count = await client.from("document_chunks").select("id", { count: "exact", head: true }).eq("document_id", local.id);
    if (count.error) throw count.error; assert.equal(count.count, local.chunks);
    const sample = await client.from("document_chunks").select("content,embedding").eq("document_id", local.id).order("id").limit(1).single();
    if (sample.error) throw sample.error;
    const key = createHash("sha256").update(`${EMBEDDING_VERSION}:${sample.data.content}`).digest("hex");
    const expected = cache[key]; assert.ok(expected, `${local.title} must use the local model`);
    const actual = typeof sample.data.embedding === "string" ? JSON.parse(sample.data.embedding) as number[] : sample.data.embedding as number[];
    assert.equal(actual.length, 768); assert.ok(actual.every((v, i) => Math.abs(v - expected[i]) < 0.000001));
    const file: { data: Blob | null; error: { message: string } | null } = await client.storage.from("materials").download(remote.storage_path);
    if (file.error) throw new Error(file.error.message); assert.ok(file.data);
    const original: Buffer = await fs.readFile(local.filePath!);
    const stored: Buffer = Buffer.from(await file.data.arrayBuffer());
    assert.equal(createHash("sha256").update(original).digest("hex"), createHash("sha256").update(stored).digest("hex"));
    pages += local.pages; passages += local.chunks;
    console.log(`Verified PDF and local index: ${local.title}`);
  }
  for (let i=0;i<catalog.documents.length;i+=4) await Promise.all(catalog.documents.slice(i,i+4).map(verifyOne));
  const bucket = await client.storage.getBucket("materials"); if (bucket.error) throw bucket.error; assert.equal(bucket.data.public, false);
  const questions = [
    { question: "Explain pointers in C with a simple example.", subject: "programming", unit: 4 },
    { question: "What is surveying? Explain its purpose.", subject: "civil-mechanical", unit: 2 },
    { question: "What is intrapersonal communication?", subject: "english", unit: 5 },
    { question: "Explain classes and objects in Java.", subject: "java", unit: null },
    { question: "Explain binary search trees and tree traversal.", subject: "algorithms", unit: null },
    { question: "Explain logic gates and Boolean algebra.", subject: "digital-logic", unit: 1 },
    { question: "What is self-exploration in Universal Human Values?", subject: "human-values", unit: null },
    { question: "Explain the story The Gift of the Magi.", subject: "english", unit: 1 }
  ];
  const vectors = await embedTexts(questions.map(q => q.question));
  const searches = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const result = await client.rpc("match_course_chunks", { query_embedding: vectors[i], selected_subject: q.subject, selected_unit: q.unit, match_limit: 4 });
    if (result.error) throw result.error;
    assert.ok(result.data?.length, `Search should find evidence for ${q.question}`);
    assert.ok(result.data.every((r: { subject: string; unit: number|null }) => r.subject === q.subject && (!q.unit || r.unit === q.unit)));
    searches.push({ question: q.question, document: result.data[0].title, page: result.data[0].page, similarity: result.data[0].similarity });
    console.log(`Search verified: ${q.question} -> ${result.data[0].title}, page ${result.data[0].page}`);
  }
  await fs.writeFile(path.join(DATA_DIR, "materials-verification.json"), JSON.stringify({ verifiedAt: new Date().toISOString(), documents: catalog.documents.length, pages, passages, privateBucket: true, embeddingModel: EMBEDDING_VERSION, geminiRequests: 0, searches }, null, 2));
  console.log(`PASS: ${catalog.documents.length} PDFs match the originals, ${pages} pages, ${passages} local embeddings. Private storage and vector search verified. Zero Gemini requests.`);
}
try { await main(); }
catch (error) {
  let message = error instanceof Error ? error.message : (error as { message?: string }).message || "Verification failed";
  for (const secret of [configuration().geminiKey, configuration().secretKey]) if (secret) message = message.replaceAll(secret, "[redacted]");
  console.error(message); process.exitCode = 1;
}
