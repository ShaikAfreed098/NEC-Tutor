import { db } from "./auth";
import { AppError } from "./config";
import { readCatalog, withPreview } from "./local-store";
import type { Identity, Conversation, Message, Ticket, DocumentRecord } from "./types";
function checked(error: { message: string } | null) { if (error) throw new AppError(`Database: ${error.message}`, 503); }
export async function documents(identity: Identity): Promise<DocumentRecord[]> {
  if (identity.preview) return (await readCatalog()).documents.map(({ filePath: _, ...d }) => d);
  const { data, error } = await db(identity.token).from("documents").select("*").order("subject").order("unit"); checked(error);
  return (data || []).map(d => ({ id:d.id,title:d.title,filename:d.filename,subject:d.subject,unit:d.unit,pages:d.pages,chunks:d.chunk_count,status:d.status,ocrPages:d.ocr_pages,storagePath:d.storage_path,uploadedAt:d.uploaded_at }));
}
export async function conversations(identity: Identity): Promise<Conversation[]> {
  if (identity.preview) return withPreview(s => s.conversations.filter(c => c.userId === identity.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));
  const { data, error } = await db(identity.token).from("conversations").select("*, messages(*)").eq("user_id",identity.id).order("created_at",{ascending:false}).limit(30); checked(error);
  return (data || []).map(c => ({ id:c.id,userId:c.user_id,title:c.title,subject:c.subject,createdAt:c.created_at,messages:c.messages.map((m: Record<string, unknown>)=>({ id:m.id,role:m.role,content:m.content,sources:m.sources,needsEscalation:m.needs_escalation,createdAt:m.created_at })).sort((a:Message,b:Message)=>a.createdAt.localeCompare(b.createdAt)) }));
}
export async function conversation(identity: Identity, id?: string | null) {
  if (!id) return null;
  const found = (await conversations(identity)).find(c=>c.id===id);
  if (!found) throw new AppError("Conversation not found.",404);
  return found;
}
export async function saveExchange(identity: Identity, current: Conversation | null, subject: string, user: Message, assistant: Message) {
  const entry: Conversation = current || { id:crypto.randomUUID(),userId:identity.id,title:user.content.slice(0,65),subject,createdAt:user.createdAt,messages:[] };
  if (identity.preview) return withPreview(store => {
    const existing = store.conversations.find(c=>c.id===entry.id && c.userId===identity.id);
    if (existing) existing.messages.push(user,assistant);
    else store.conversations.push({...entry,messages:[user,assistant]});
    return entry.id;
  });
  const client=db(identity.token);
  if (!current) { const result=await client.from("conversations").insert({id:entry.id,user_id:identity.id,title:entry.title,subject,created_at:entry.createdAt}); checked(result.error); }
  const result=await client.from("messages").insert([user,assistant].map(m=>({id:m.id,conversation_id:entry.id,role:m.role,content:m.content,sources:m.sources,needs_escalation:!!m.needsEscalation,created_at:m.createdAt}))); checked(result.error);
  return entry.id;
}
export async function tickets(identity: Identity): Promise<Ticket[]> {
  if (identity.preview) return withPreview(s=>s.tickets.filter(t=>identity.role==="admin" || t.userId===identity.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));
  let query=db(identity.token).from("tickets").select("*, ticket_replies(*)").order("created_at",{ascending:false});
  if (identity.role!=="admin") query=query.eq("user_id",identity.id);
  const {data,error}=await query; checked(error);
  return (data || []).map(t=>({id:t.id,userId:t.user_id,studentName:t.student_name,question:t.question,summary:t.summary,sources:t.sources,status:t.status,createdAt:t.created_at,replies:t.ticket_replies.map((r:Record<string,unknown>)=>({id:r.id,author:r.author,content:r.content,createdAt:r.created_at})).sort((a:{createdAt:string},b:{createdAt:string})=>a.createdAt.localeCompare(b.createdAt))}));
}
export async function createTicket(identity: Identity, question: string, conversationId: string | null) {
  const context=await conversation(identity,conversationId);
  const last=context?.messages.slice(-6) || [];
  const ticket: Ticket={id:crypto.randomUUID(),userId:identity.id,studentName:identity.profile.name,question,summary:last.map(m=>`${m.role}: ${m.content}`).join("\n\n").slice(0,6000) || question,sources:last.filter(m=>m.role==="assistant").at(-1)?.sources || [],status:"open",createdAt:new Date().toISOString(),replies:[]};
  if (identity.preview) await withPreview(s=>{s.tickets.push(ticket);});
  else { const result=await db(identity.token).from("tickets").insert({id:ticket.id,user_id:ticket.userId,student_name:ticket.studentName,question,summary:ticket.summary,sources:ticket.sources,status:"open"}); checked(result.error); }
  return ticket;
}
