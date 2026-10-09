export const SUBJECTS = [
  { id: "programming", name: "Introduction to Programming", short: "Programming", description: "C fundamentals, arrays, pointers & functions", color: "blue" },
  { id: "chemistry", name: "Chemistry", short: "Chemistry", description: "Materials, chemistry & instrumentation", color: "purple" },
  { id: "civil-mechanical", name: "Basic Civil and Mechanical Engineering", short: "Civil & Mechanical", description: "Surveying, manufacturing & power plants", color: "orange" },
  { id: "english", name: "English", short: "English", description: "Communication & language skills", color: "blue" },
  { id: "java", name: "Java", short: "Java", description: "Classes, objects, inheritance & exceptions", color: "orange" },
  { id: "algorithms", name: "Advanced Data Structures and Algorithms", short: "Data Structures", description: "Trees, graphs, algorithms & analysis", color: "purple" },
  { id: "digital-logic", name: "Digital Logic & Computer Organization", short: "Digital Logic", description: "Logic circuits, processors & memory", color: "blue" },
  { id: "human-values", name: "Universal Human Values", short: "Human Values", description: "Harmony, relationships & ethical understanding", color: "orange" },
  { id: "academic", name: "Academic Documents", short: "Exam schedules", description: "Demo timetable & academic notices", color: "purple" }
] as const;
export type Source = { reference?: number; documentId: string; title: string; page: number; excerpt: string; subject: string; unit: number | null };
export type DocumentRecord = { id: string; title: string; filename: string; subject: string; unit: number | null; pages: number; chunks: number; status: "ready" | "needs_ocr" | "error" | "processing"; ocrPages: number; filePath?: string; storagePath?: string; error?: string; uploadedAt: string };
export type Chunk = { id: string; documentId: string; text: string; page: number; subject: string; unit: number | null; title: string };
export type Catalog = { version: number; generatedAt: string; documents: DocumentRecord[]; chunks: Chunk[] };
export type Profile = { id: string; name: string; role: "student" | "admin"; department: string; semester: string; preferredStyle: string; subjects: string[] };
export type Message = { id: string; role: "user" | "assistant"; content: string; sources: Source[]; needsEscalation?: boolean; createdAt: string };
export type Conversation = { id: string; userId: string; title: string; subject: string; createdAt: string; messages: Message[] };
export type Reply = { id: string; author: string; content: string; createdAt: string };
export type Ticket = { id: string; userId: string; studentName: string; question: string; summary: string; sources: Source[]; status: "open" | "in_progress" | "resolved"; createdAt: string; replies: Reply[] };
export type Identity = { id: string; role: "student" | "admin"; token?: string; preview: boolean; profile: Profile };
