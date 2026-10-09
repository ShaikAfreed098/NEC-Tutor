import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models", { headers: { "x-goog-api-key": process.env.GEMINI_API_KEY || "" } });
if (!response.ok) throw new Error(`Model availability check failed (${response.status}).`);
const data = await response.json() as { models: { name: string; supportedGenerationMethods?: string[] }[] };
console.log(data.models.filter(m => m.supportedGenerationMethods?.includes("generateContent") && /flash/.test(m.name)).map(m => m.name).join("\n"));
