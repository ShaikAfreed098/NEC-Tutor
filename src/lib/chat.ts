import { db } from "./auth";
import { AppError } from "./config";
import { readCatalog } from "./local-store";
import { lexicalRetrieve } from "./retrieval";
import { answerWithEvidence } from "./gemini";
import { embedTexts } from "./embeddings";
import { academicQuery } from "./academic-query";
import { conversation, saveExchange } from "./repository";
import type { Chunk, Identity, Message, Source } from "./types";
const usage = new Map<string,{start:number,count:number}>();
export async function chat(identity:Identity, question:string, subject:string, unit:number|null, conversationId:string|null) {
  const now=Date.now(); let window=usage.get(identity.id);
  if (!window || now-window.start>60000) {window={start:now,count:0}; usage.set(identity.id,window);}
  if (++window.count>12) throw new AppError("Please wait a moment before sending another question.",429);
  const current=await conversation(identity,conversationId);
  const history=current?.messages || [];
  const previous=history.filter(m=>m.role==="user").at(-1)?.content || "";
  const isFollowup=/\b(it|that|these|those|more|again|example|simpler|shorter|continue)\b/i.test(question) || question.split(/\s+/).length<5;
  const plan=academicQuery(question,subject,unit,previous);
  const search=plan.official ? `${question}\nExam timetable schedule ${plan.selectedCourse}` : isFollowup && previous ? `${previous}\n${question}` : question;
  let evidence:Chunk[]=[];
  if (identity.preview) {
    let chunks=(await readCatalog()).chunks;
    evidence=lexicalRetrieve(chunks,search,plan.subject,plan.unit).map(r=>r.chunk);
  }
  else if (plan.official) {
    // Timetables are short structured notices; keyword retrieval reliably finds their dates.
    const result=await db(identity.token).from("document_chunks").select("id,document_id,content,page,documents!inner(title,subject,unit,status)").eq("documents.subject","academic").eq("documents.status","ready").limit(300);
    if(result.error)throw new AppError(`Academic document search: ${result.error.message}`,503);
    const chunks:Chunk[]=(result.data || []).map(r=>{const d=r.documents as unknown as {title:string;subject:string;unit:number|null};return {id:String(r.id),documentId:String(r.document_id),text:r.content,page:r.page,title:d.title,subject:d.subject,unit:d.unit};});
    evidence=lexicalRetrieve(chunks,search,"academic",null).slice(0,4).map(r=>r.chunk);
  }
  else {
    const [vector]=await embedTexts([search]);
    const result=await db(identity.token).rpc("match_course_chunks",{query_embedding:vector,selected_subject:plan.subject,selected_unit:plan.unit,match_limit:4});
    if(result.error) throw new AppError(`Document search: ${result.error.message}`,503);
    evidence=(result.data || []).map((r:Record<string,unknown>)=>({id:String(r.id),documentId:String(r.document_id),text:String(r.content),page:Number(r.page),title:String(r.title),subject:String(r.subject),unit:r.unit as number|null}));
  }
  if (plan.official) evidence=evidence.filter(c=>/timetable|schedule|calendar|guideline|policy|notice|exam/i.test(c.title));
  let answer="I couldn’t find an answer in the selected notes. Try naming the topic and unit, or send your question to staff.";
  let references:number[]=[]; let needsEscalation=true;
  if(identity.preview && evidence.length) {evidence=evidence.slice(0,3); references=evidence.map((_,i)=>i+1); needsEscalation=false; answer="**From your course notes**\n\n"+evidence.map((c,i)=>`${c.text.slice(0,850).trim()}${c.text.length>850?"…":""} [${i+1}]`).join("\n\n---\n\n")+"\n\n*Preview shows matching passages. Enable live mode for Gemini explanations.*";}
  if(!identity.preview) { const result=await answerWithEvidence(question,evidence,identity.profile,history,plan.selectedCourse); answer=result.answer;references=result.references;needsEscalation=result.needsEscalation; }
  const sources:Source[]=references.map(n=>{const c=evidence[n-1];return {reference:n,documentId:c.documentId,title:c.title,page:c.page,excerpt:c.text.slice(0,500),subject:c.subject,unit:c.unit};});
  const user:Message={id:crypto.randomUUID(),role:"user",content:question,sources:[],createdAt:new Date().toISOString()};
  const assistant:Message={id:crypto.randomUUID(),role:"assistant",content:answer,sources,needsEscalation,createdAt:new Date(Date.now()+1).toISOString()};
  const id=await saveExchange(identity,current,subject,user,assistant);
  return {conversationId:id,message:assistant};
}
