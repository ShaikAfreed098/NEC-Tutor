import { createClient } from "@supabase/supabase-js";
import { configuration, AppError } from "./config";
import { withPreview, defaultProfile } from "./local-store";
import type { Identity, Profile } from "./types";
export function db(token?: string, admin = false) {
  const config = configuration();
  if (!config.supabaseUrl || !(admin ? config.secretKey : config.publishableKey)) throw new AppError("Configure your Supabase project in .env.local first.", 503);
  return createClient(config.supabaseUrl, admin ? config.secretKey : config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
  });
}
export function profileFromRow(row: Record<string, unknown>): Profile {
  return { id: String(row.id), name: String(row.name || "Student"), role: row.role === "admin" ? "admin" : "student",
    department: String(row.department || ""), semester: String(row.semester || ""), preferredStyle: String(row.preferred_style || "simple"), subjects: (row.subjects || []) as string[] };
}
export async function identify(request: Request, adminOnly = false): Promise<Identity> {
  const config = configuration();
  if (!config.live) {
    const hostname = new URL(request.url).hostname;
    if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) throw new AppError("Preview mode is only available on this computer.", 403);
    const requested = request.headers.get("x-preview-user") || "student";
    if (!["student", "student-two", "admin"].includes(requested)) throw new AppError("Unknown preview account.", 401);
    const role = requested === "admin" ? "admin" : "student";
    if (adminOnly && role !== "admin") throw new AppError("Staff access is required.", 403);
    const profile = await withPreview(store => store.profiles[requested] ||= defaultProfile(requested, role));
    return { id: requested, role, preview: true, profile };
  }
  if (config.missing.length) throw new AppError(`Complete .env.local: ${config.missing.join(", ")}`, 503);
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) throw new AppError("Please sign in.", 401);
  const client = db(token);
  const { data: { user }, error } = await client.auth.getUser(token);
  if (error || !user) throw new AppError("Your session expired. Please sign in again.", 401);
  const result = await client.from("profiles").select("*").eq("id", user.id).single();
  if (result.error) throw new AppError("Your profile is not ready. Run supabase/schema.sql and sign in again.", 503);
  const profile = profileFromRow(result.data);
  if (adminOnly && profile.role !== "admin") throw new AppError("Staff access is required.", 403);
  return { id: user.id, role: profile.role, preview: false, token, profile };
}
export function ensureSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  try {
    const incoming = new URL(origin); const target = new URL(request.url);
    const loopback = ["localhost", "127.0.0.1", "[::1]"];
    const sameLocalPort = loopback.includes(incoming.hostname) && loopback.includes(target.hostname) && incoming.port === target.port && incoming.protocol === target.protocol;
    if (incoming.origin !== target.origin && !sameLocalPort) throw new Error("mismatch");
  } catch { throw new AppError("Cross-site requests are not allowed.", 403); }
}
