import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { db } from "../src/lib/auth";
import { DATA_DIR } from "../src/lib/local-store";

const file = path.join(DATA_DIR, "demo-login.json");
type DemoLogin = { id: string; email: string; password: string };
let login: DemoLogin | undefined;
try { login = JSON.parse(await fs.readFile(file, "utf8")) as DemoLogin; }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
if (!login) {
  let email = "demo.student@nec-tutor.example";
  const password = `NecTutor!${randomBytes(6).toString("hex")}9`;
  const service = db(undefined, true);
  let result = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: "Demo student", nec_tutor_demo: true } });
  if (result.error && /already|registered|exists/i.test(result.error.message)) {
    email = `demo.student.${randomBytes(3).toString("hex")}@nec-tutor.example`;
    result = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: "Demo student", nec_tutor_demo: true } });
  }
  if (result.error) throw new Error(`Demo account creation failed: ${result.error.message}`);
  if (!result.data.user) throw new Error("Demo account was not returned.");
  login = { id: result.data.user.id, email, password };
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(file, JSON.stringify(login, null, 2), { flag: "wx" });
}
const signedIn = await db().auth.signInWithPassword({ email: login.email, password: login.password });
if (signedIn.error || !signedIn.data.session) throw new Error(`Demo sign-in failed: ${signedIn.error?.message || "No session"}`);
if (signedIn.data.user?.id !== login.id) throw new Error("Demo account identity did not match.");
const headers = { Authorization: `Bearer ${signedIn.data.session.access_token}` };
const response = await fetch("http://127.0.0.1:3000/api/profile", { headers });
const profile = await response.json() as { role?: string; error?: string };
if (!response.ok || profile.role !== "student") throw new Error(`Demo profile check failed: ${profile.error || "Unexpected role"}`);
const materials = await fetch("http://127.0.0.1:3000/api/documents", { headers });
if (!materials.ok) throw new Error("Demo account could not load the course library.");
const documents = await materials.json() as unknown[];
// This prints only the requested demo login, never service/API keys or tokens.
console.log(JSON.stringify({ email: login.email, password: login.password, role: "student", signInVerified: true, courseDocuments: documents.length }));
