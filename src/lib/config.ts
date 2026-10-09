export function configuration() {
  const live = process.env.NEC_MODE === "live";
  const missing = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "GEMINI_API_KEY"].filter(key => !process.env[key]?.trim());
  let validUrl = false;
  try { const url = new URL(process.env.SUPABASE_URL || ""); validUrl = url.protocol === "https:" && url.hostname.endsWith(".supabase.co") && ["", "/"].includes(url.pathname); } catch {}
  const rawPublicKey = process.env.SUPABASE_PUBLISHABLE_KEY || "";
  let isSecret = rawPublicKey.startsWith("sb_secret_");
  try { if (rawPublicKey.split(".").length === 3) isSecret ||= JSON.parse(Buffer.from(rawPublicKey.split(".")[1], "base64url").toString()).role === "service_role"; } catch {}
  if (!validUrl && process.env.SUPABASE_URL) missing.push("SUPABASE_URL (use the project API URL ending in .supabase.co)");
  if (isSecret) missing.push("SUPABASE_PUBLISHABLE_KEY (use a publishable or anon key, not a server secret)");
  return { mode: live ? "live" : "preview", live, missing, ready: live && missing.length === 0,
    supabaseUrl: validUrl ? process.env.SUPABASE_URL!.replace(/\/$/, "") : "", publishableKey: isSecret ? "" : rawPublicKey,
    secretKey: process.env.SUPABASE_SECRET_KEY || "", geminiKey: process.env.GEMINI_API_KEY || "",
    chatModel: process.env.GEMINI_CHAT_MODEL || "gemini-3.5-flash-lite" };
}
export class AppError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
