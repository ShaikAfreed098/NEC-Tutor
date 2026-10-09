import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { readCatalog, writeCatalog } from "../src/lib/local-store";
import { extractDocument, syncDocument } from "../src/lib/importer";
import { SUBJECTS, type DocumentRecord } from "../src/lib/types";
const root = path.resolve(process.env.MATERIALS_DIR || "Subject Pdfs");
const ocr = process.argv.includes("--ocr");
const live = process.argv.includes("--live");
const catalog = await readCatalog();
async function walk(folder: string): Promise<string[]> { const entries = await fs.readdir(folder, { withFileTypes: true }); const results: string[] = []; for (const entry of entries) { const full = path.join(folder, entry.name); if (entry.isDirectory()) results.push(...await walk(full)); else if (entry.name.toLowerCase().endsWith(".pdf")) results.push(full); } return results; }
let failures = 0;
for (const file of (await walk(root)).sort()) {
  const filename = path.basename(file); const relative = path.relative(root, file);
  const folder = relative.split(path.sep)[0].toLowerCase();
  const match = SUBJECTS.find(s => s.name.toLowerCase() === folder);
  const subject = match?.id || "";
  if (!subject) { console.warn(`Skipped unrecognized subject folder: ${relative}. Add its subject mapping before importing.`); continue; }
  const unit = Number(filename.match(/unit\s*(\d)/i)?.[1]) || null;
  const prefix = subject === "civil-mechanical" ? `${/^civil/i.test(filename) ? "Civil" : "Mechanical"} Engineering` : match!.short;
  const title = subject === "academic" ? filename.replace(/\.pdf$/i, "") : unit ? `${prefix} - Unit ${unit}${/from AIML/i.test(filename) ? " (AIML notes)" : ""}` : `${prefix} - ${filename.replace(/\.pdf$/i, "")}`;
  const hash = createHash("sha256").update(relative.toLowerCase()).digest("hex");
  const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
  let document = catalog.documents.find(d => d.id === id);
  if (document && (document.subject !== subject || document.title !== title)) {
    document.subject = subject; document.title = title;
    for (const chunk of catalog.chunks.filter(c => c.documentId === id)) { chunk.subject = subject; chunk.title = title; }
    await writeCatalog(catalog);
  }
  try {
    const stat = await fs.stat(file);
    const unchanged = document && document.uploadedAt === stat.mtime.toISOString() && document.status === "ready";
    if (!unchanged || (ocr && document?.status === "needs_ocr")) {
      console.log(`Reading ${relative}`);
      const extracted = await extractDocument(await fs.readFile(file), { id, title, subject, unit }, ocr, console.log);
      document = { id, title, filename, subject, unit, pages: extracted.pages, chunks: extracted.chunks.length, status: extracted.chunks.length ? "ready" : "needs_ocr", ocrPages: extracted.ocrPages, filePath: file, uploadedAt: stat.mtime.toISOString() };
      catalog.documents = catalog.documents.filter(d => d.id !== id).concat(document);
      catalog.chunks = catalog.chunks.filter(c => c.documentId !== id).concat(extracted.chunks);
      catalog.generatedAt = new Date().toISOString(); await writeCatalog(catalog);
    } else console.log(`Cached ${relative}`);
    if (live) { await syncDocument(document!, catalog.chunks.filter(c => c.documentId === id), console.log); console.log(`Synced ${title}`); }
  } catch (error) { failures++; console.error(`Failed ${relative}: ${(error as Error).message}`); }
}
console.log(`\n${catalog.documents.length} documents, ${catalog.chunks.length} passages. ${catalog.documents.filter(d=>d.status === "needs_ocr").length} documents need OCR. ${failures} failures.`);
if (failures) process.exitCode = 1;
