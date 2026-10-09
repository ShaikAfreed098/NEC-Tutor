import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { PDFParse } from "pdf-parse";
import { createWorker } from "tesseract.js";
import { chunkPage } from "./retrieval";
import { DATA_DIR } from "./local-store";
import { db } from "./auth";
import { embedTexts, EMBEDDING_VERSION } from "./embeddings";
import type { DocumentRecord, Chunk } from "./types";
export function embeddingCacheKey(text: string) { return createHash("sha256").update(`${EMBEDDING_VERSION}:${text}`).digest("hex"); }

export async function extractDocument(buffer: Buffer, metadata: { id: string; title: string; subject: string; unit: number | null }, ocr = false, log: (message: string) => void = () => {}) {
  const parser = new PDFParse({ data: buffer });
  const chunks: Chunk[] = []; let ocrPages = 0; let emptyPages = 0;
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  try {
    const parsed = await parser.getText();
    for (const page of parsed.pages) {
      let text = page.text;
      if (text.trim().length < 40 && ocr) {
        if (!worker) {
          await fs.mkdir(path.join(DATA_DIR, "ocr"), { recursive: true });
          worker = await createWorker("eng", 1, { cachePath: path.join(DATA_DIR, "ocr"), logger: () => {} });
        }
        log(`OCR ${metadata.title}, page ${page.num}/${parsed.total}`);
        const screenshots = await parser.getScreenshot({ partial: [page.num], desiredWidth: 1500, imageBuffer: true, imageDataUrl: false });
        const image = screenshots.pages[0]?.data;
        if (image) { text = (await worker.recognize(Buffer.from(image))).data.text; ocrPages++; }
      }
      if (text.trim().length < 40) emptyPages++;
      chunkPage(text).forEach((text, i) => chunks.push({ id: `${metadata.id}:${page.num}:${i}`, documentId: metadata.id, text, page: page.num, subject: metadata.subject, unit: metadata.unit, title: metadata.title }));
    }
    return { pages: parsed.total, chunks, ocrPages, emptyPages };
  } finally { await worker?.terminate(); await parser.destroy(); }
}

export async function syncDocument(document: DocumentRecord, chunks: Chunk[], log: (message: string) => void = () => {}) {
  if (!chunks.length) throw new Error(`${document.title}: no readable text. Re-import with --ocr.`);
  const client = db(undefined, true);
  const storagePath = `${document.id}/${document.filename}`;
  const cacheFile = path.join(DATA_DIR, "local-embedding-cache.json");
  let cache: Record<string, number[]> = {};
  try { cache = JSON.parse(await fs.readFile(cacheFile, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const vectors: number[][] = chunks.map(c => cache[embeddingCacheKey(c.text)]);
  const missing = chunks.map((c, index) => ({ chunk: c, index })).filter(c => !vectors[c.index]);
  log(`${document.title}: ${chunks.length - missing.length}/${chunks.length} embeddings cached`);
  for (let i = 0; i < missing.length; i += 10) {
    const items = missing.slice(i, i + 10);
    const batch = await embedTexts(items.map(c => c.chunk.text));
    items.forEach((item, n) => { vectors[item.index] = batch[n]; cache[embeddingCacheKey(item.chunk.text)] = batch[n]; });
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(cacheFile, JSON.stringify(cache));
    log(`Indexing ${document.title}: ${chunks.length - missing.length + Math.min(i + 10, missing.length)}/${chunks.length} passages`);
  }
  if (!document.filePath) throw new Error("Document file path is missing.");
  const upload = await client.storage.from("materials").upload(storagePath, await fs.readFile(document.filePath), { contentType: "application/pdf", upsert: true });
  if (upload.error) throw new Error(`Storage: ${upload.error.message}`);
  const result = await client.rpc("replace_document_index", {
    document_data: { id: document.id, title: document.title, filename: document.filename, subject: document.subject, unit: document.unit, pages: document.pages, chunk_count: chunks.length, ocr_pages: document.ocrPages, storage_path: storagePath },
    chunk_data: chunks.map((c, i) => ({ content: c.text, page: c.page, embedding: vectors[i] }))
  });
  if (result.error) throw new Error(`Database: ${result.error.message}`);
  return storagePath;
}
