import { promises as fs } from "node:fs";
import path from "node:path";
import type { Catalog, Profile, Conversation, Ticket } from "./types";
export const DATA_DIR = path.join(process.cwd(), ".data");
export type PreviewStore = { profiles: Record<string, Profile>; conversations: Conversation[]; tickets: Ticket[] };
let queue: Promise<unknown> = Promise.resolve();
export async function readCatalog(): Promise<Catalog> {
  try { return JSON.parse(await fs.readFile(path.join(DATA_DIR, "catalog.json"), "utf8")); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; return { version: 1, generatedAt: "", documents: [], chunks: [] }; }
}
export async function writeCatalog(catalog: Catalog) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temporary = path.join(DATA_DIR, `catalog-${crypto.randomUUID()}.tmp`);
  await fs.writeFile(temporary, JSON.stringify(catalog));
  await fs.rename(temporary, path.join(DATA_DIR, "catalog.json"));
}
async function readStore(): Promise<PreviewStore> {
  try { return JSON.parse(await fs.readFile(path.join(DATA_DIR, "preview.json"), "utf8")); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; return { profiles: {}, conversations: [], tickets: [] }; }
}
export async function withPreview<T>(fn: (store: PreviewStore) => T | Promise<T>): Promise<T> {
  const result = queue.then(async () => {
    const store = await readStore(); const value = await fn(store);
    await fs.mkdir(DATA_DIR, { recursive: true });
    const temporary = path.join(DATA_DIR, `preview-${crypto.randomUUID()}.tmp`);
    await fs.writeFile(temporary, JSON.stringify(store));
    await fs.rename(temporary, path.join(DATA_DIR, "preview.json"));
    return value;
  });
  queue = result.catch(() => undefined);
  return result;
}
export function defaultProfile(id: string, role: "student" | "admin" = "student"): Profile {
  return { id, name: role === "admin" ? "Demo staff" : id === "student-two" ? "Second demo student" : "Demo student", role,
    department: "", semester: "", preferredStyle: "simple", subjects: ["programming", "chemistry", "civil-mechanical", "english"] };
}
