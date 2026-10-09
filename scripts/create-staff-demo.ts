import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { db } from "../src/lib/auth";
import { DATA_DIR } from "../src/lib/local-store";

const file = path.join(DATA_DIR, "staff-demo-login.json");
type DemoLogin = { id: string; email: string; password: string };
let login: DemoLogin | undefined;
try { login = JSON.parse(await fs.readFile(file, "utf8")) as DemoLogin; }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
const service = db(undefined, true);
if (!login) {
  let email = "demo.staff@nec-tutor.example";
  const password = `NecStaff!${randomBytes(6).toString("hex")}9`;
  let result = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: "Demo staff", nec_tutor_demo: true } });
  if (result.error && /already|registered|exists/i.test(result.error.message)) {
    email = `demo.staff.${randomBytes(3).toString("hex")}@nec-tutor.example`;
    result = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: "Demo staff", nec_tutor_demo: true } });
  }
  if (result.error || !result.data.user) throw new Error(`Demo account creation failed: ${result.error?.message || "No user"}`);
  login = { id: result.data.user.id, email, password };
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(file, JSON.stringify(login, null, 2), { flag: "wx" });
}
const existing = await service.auth.admin.getUserById(login.id);
if (existing.error || existing.data.user?.email !== login.email || !existing.data.user?.user_metadata.nec_tutor_demo) throw new Error("Saved staff demo identity did not match.");
const promote = await service.from("profiles").update({ role: "admin" }).eq("id", login.id).select("id").single();
if (promote.error) throw new Error(`Staff profile setup: ${promote.error.message}`);
const signedIn = await db().auth.signInWithPassword({ email: login.email, password: login.password });
if (signedIn.error || !signedIn.data.session || signedIn.data.user?.id !== login.id) throw new Error(`Demo sign-in failed: ${signedIn.error?.message || "Identity mismatch"}`);
const headers = { Authorization: `Bearer ${signedIn.data.session.access_token}` };
const response = await fetch("http://127.0.0.1:3000/api/profile", { headers });
const profile = await response.json() as { role?: string; error?: string };
if (!response.ok || profile.role !== "admin") throw new Error(`Demo staff check failed: ${profile.error || "Unexpected role"}`);
const access = await fetch("http://127.0.0.1:3000/api/admin/local-documents", { headers });
if (!access.ok) throw new Error("Demo staff could not access the staff workspace.");
console.log(JSON.stringify({ email: login.email, password: login.password, role: "staff", signInVerified: true, staffAccessVerified: true }));
