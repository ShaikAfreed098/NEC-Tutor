import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { configuration, AppError } from "@/lib/config";
import { identify, ensureSameOrigin, db, profileFromRow } from "@/lib/auth";
import { readCatalog, writeCatalog, withPreview, DATA_DIR } from "@/lib/local-store";
import { documents, conversations, tickets, createTicket } from "@/lib/repository";
import { chat } from "@/lib/chat";
import { SUBJECTS, type DocumentRecord, type Reply } from "@/lib/types";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=300;
const subjectSchema=z.enum(["all",...SUBJECTS.map(s=>s.id)]);
const signupUsage=new Map<string,{start:number;count:number}>();
async function json(request:Request) {const value=await request.text();if(value.length>32000)throw new AppError("Request is too large.",413);return JSON.parse(value);}
function ok(value:unknown,status=200){return Response.json(value,{status,headers:{"Cache-Control":"no-store"}});}
function databaseError(error:{message:string}|null){if(error)throw new AppError(`Database: ${error.message}`,503);}
async function handle(request:Request,context:{params:Promise<{path:string[]}>}) {
  try {
    const segments=(await context.params).path;
    const resource=segments[0];const id=segments[1];const method=request.method;
    if(method!=="GET")ensureSameOrigin(request);
    const settings=configuration();
    if(resource==="config" && method==="GET")return ok({mode:settings.mode,missing:settings.missing,ready:settings.ready,supabaseUrl:settings.supabaseUrl,publishableKey:settings.publishableKey});
    if(resource==="signup" && method==="POST") {
      if(!settings.live || settings.missing.length)throw new AppError("Account setup is not ready.",503);
      const input=z.object({email:z.email().trim().max(254),password:z.string().min(8).max(128),name:z.string().trim().min(1).max(80)}).parse(await json(request));
      const caller=request.headers.get("x-forwarded-for")?.split(",")[0] || "local"; const now=Date.now();
      let usage=signupUsage.get(caller); if(!usage || now-usage.start>600000){usage={start:now,count:0};signupUsage.set(caller,usage);}
      if(++usage.count>10)throw new AppError("Please wait before creating another account.",429);
      const created=await db(undefined,true).auth.admin.createUser({email:input.email,password:input.password,email_confirm:true,user_metadata:{name:input.name}});
      if(created.error)throw new AppError(/already|registered|exists/i.test(created.error.message)?"This email already has an account. Please sign in.":"Could not create the account. Check the email and use a stronger password.",400);
      return ok({created:true},201);
    }
    const adminOnly=resource==="admin" || (resource==="documents" && method!=="GET") || (resource==="tickets" && (method==="PATCH" || segments[2]==="replies"));
    const identity=await identify(request,adminOnly);
    if(resource==="profile") {
      if(method==="GET")return ok(identity.profile);
      if(method==="PATCH") {
        const input=z.object({name:z.string().trim().min(1).max(80),department:z.string().max(100),semester:z.string().max(20),preferredStyle:z.enum(["simple","detailed","exam-focused"]),subjects:z.array(subjectSchema.exclude(["all"])).max(SUBJECTS.length)}).parse(await json(request));
        if(identity.preview)return ok(await withPreview(s=>{s.profiles[identity.id]={...identity.profile,...input};return s.profiles[identity.id];}));
        const result=await db(identity.token).from("profiles").update({name:input.name,department:input.department,semester:input.semester,preferred_style:input.preferredStyle,subjects:input.subjects}).eq("id",identity.id).select().single();databaseError(result.error);return ok(profileFromRow(result.data));
      }
      if(method==="DELETE") {
        const reset={department:"",semester:"",preferredStyle:"simple",subjects:[]};
        if(identity.preview)await withPreview(s=>{s.profiles[identity.id]={...identity.profile,...reset};s.conversations=s.conversations.filter(c=>c.userId!==identity.id);});
        else {const client=db(identity.token);const a=await client.from("conversations").delete().eq("user_id",identity.id);databaseError(a.error);const b=await client.from("profiles").update({department:"",semester:"",preferred_style:"simple",subjects:[]}).eq("id",identity.id);databaseError(b.error);}
        return ok({cleared:true});
      }
    }
    if(resource==="conversations" && method==="GET")return ok(await conversations(identity));
    if(resource==="chat" && method==="POST") {
      const input=z.object({question:z.string().trim().min(2).max(4000),subject:subjectSchema,unit:z.number().int().min(1).max(10).nullable(),conversationId:z.string().max(100).nullable()}).parse(await json(request));
      return ok(await chat(identity,input.question,input.subject,input.unit,input.conversationId));
    }
    if(resource==="tickets") {
      if(method==="GET")return ok(await tickets(identity));
      if(method==="POST" && !id) {const input=z.object({question:z.string().trim().min(5).max(4000),conversationId:z.string().nullable()}).parse(await json(request));return ok(await createTicket(identity,input.question,input.conversationId),201);}
      if(id && method==="PATCH") {
        const {status}=z.object({status:z.enum(["open","in_progress","resolved"])}).parse(await json(request));
        if(identity.preview)await withPreview(s=>{const t=s.tickets.find(t=>t.id===id);if(!t)throw new AppError("Ticket not found.",404);t.status=status;});
        else {const result=await db(identity.token).from("tickets").update({status}).eq("id",id).select("id").single();databaseError(result.error);}
        return ok({updated:true});
      }
      if(id && segments[2]==="replies" && method==="POST") {
        const {content}=z.object({content:z.string().trim().min(2).max(5000)}).parse(await json(request));
        const reply:Reply={id:crypto.randomUUID(),author:identity.profile.name,content,createdAt:new Date().toISOString()};
        if(identity.preview)await withPreview(s=>{const t=s.tickets.find(t=>t.id===id);if(!t)throw new AppError("Ticket not found.",404);t.replies.push(reply);if(t.status==="open")t.status="in_progress";});
        else {const client=db(identity.token);const result=await client.from("ticket_replies").insert({id:reply.id,ticket_id:id,author_id:identity.id,author:reply.author,content});databaseError(result.error);const update=await client.from("tickets").update({status:"in_progress"}).eq("id",id).eq("status","open");databaseError(update.error);}
        return ok(reply,201);
      }
    }
    if(resource==="documents") {
      if(method==="GET" && !id)return ok(await documents(identity));
      if(method==="GET" && segments[2]==="file") {
        if(identity.preview) {
          const document=(await readCatalog()).documents.find(d=>d.id===id);if(!document?.filePath)throw new AppError("File not found.",404);
          const actual=path.resolve(document.filePath);
          const roots=[path.resolve(/* turbopackIgnore: true */ process.env.MATERIALS_DIR || "Subject Pdfs"),path.join(DATA_DIR,"uploads")];
          if(!roots.some(root=>actual.startsWith(root+path.sep)))throw new AppError("File is outside the materials folder.",403);
          const buffer=await fs.readFile(actual);
          return new Response(buffer,{headers:{"Content-Type":"application/pdf","Content-Disposition":`inline; filename*=UTF-8''${encodeURIComponent(document.filename)}`,"Cache-Control":"private, no-store"}});
        }
        const document=(await documents(identity)).find(d=>d.id===id);if(!document?.storagePath)throw new AppError("File not found.",404);
        const result=await db(undefined,true).storage.from("materials").createSignedUrl(document.storagePath,120);databaseError(result.error);
        return Response.redirect(result.data!.signedUrl,302);
      }
      if(method==="DELETE" && id) {
        if(identity.preview){const catalog=await readCatalog();catalog.documents=catalog.documents.filter(d=>d.id!==id);catalog.chunks=catalog.chunks.filter(c=>c.documentId!==id);await writeCatalog(catalog);}
        else {const document=(await documents(identity)).find(d=>d.id===id);if(!document)throw new AppError("Document not found.",404);const client=db(undefined,true);const result=await client.from("documents").delete().eq("id",id);databaseError(result.error);if(document.storagePath){const removed=await client.storage.from("materials").remove([document.storagePath]);databaseError(removed.error);}}
        return ok({removed:true});
      }
      if(method==="POST") {
        if(Number(request.headers.get("content-length"))>27*1024*1024)throw new AppError("PDFs must be smaller than 25 MB.",413);
        const form=await request.formData();const file=form.get("file");
        if(!(file instanceof File) || file.size>25*1024*1024 || !file.name.toLowerCase().endsWith(".pdf"))throw new AppError("Choose a PDF smaller than 25 MB.");
        const subject=subjectSchema.parse(form.get("subject"));if(subject==="all")throw new AppError("Choose a subject.");
        const rawUnit=Number(form.get("unit"));const unit=rawUnit?z.number().int().min(1).max(10).parse(rawUnit):null;
        const title=z.string().trim().min(2).max(180).parse(form.get("title"));
        const buffer=Buffer.from(await file.arrayBuffer());if(buffer.subarray(0,5).toString()!=="%PDF-")throw new AppError("The uploaded file is not a valid PDF.");
        const documentId=crypto.randomUUID();const filename=path.basename(file.name).replace(/[^a-zA-Z0-9 ._-]/g,"_");
        const {extractDocument,syncDocument}=await import("@/lib/importer");
        const extracted=await extractDocument(buffer,{id:documentId,title,subject,unit},true);
        if(!extracted.chunks.length)throw new AppError("No readable text was found, even after OCR. Upload a clearer PDF.");
        await fs.mkdir(path.join(DATA_DIR,"uploads"),{recursive:true});const filePath=path.join(DATA_DIR,"uploads",`${documentId}.pdf`);await fs.writeFile(filePath,buffer);
        const document:DocumentRecord={id:documentId,title,filename,subject,unit,pages:extracted.pages,chunks:extracted.chunks.length,status:"ready",ocrPages:extracted.ocrPages,filePath,uploadedAt:new Date().toISOString()};
        if(identity.preview){const catalog=await readCatalog();catalog.documents.push(document);catalog.chunks.push(...extracted.chunks);await writeCatalog(catalog);}
        else await syncDocument(document,extracted.chunks);
        const {filePath:_,...safe}=document;return ok(safe,201);
      }
    }
    if(resource==="admin" && id==="import" && method==="POST") {
      if(identity.preview)throw new AppError("Use npm run import:materials -- --ocr to refresh the local preview library.");
      const {documentId}=z.object({documentId:z.string().uuid()}).parse(await json(request));
      const catalog=await readCatalog();const document=catalog.documents.find(d=>d.id===documentId);
      if(!document)throw new AppError("Local document not found.",404);
      const {syncDocument}=await import("@/lib/importer");await syncDocument(document,catalog.chunks.filter(c=>c.documentId===documentId));return ok({synced:document.title});
    }
    if(resource==="admin" && id==="local-documents" && method==="GET")return ok((await readCatalog()).documents.map(({filePath:_,...d})=>d));
    throw new AppError("Page not found.",404);
  } catch(error) {
    if(error instanceof z.ZodError)return ok({error:error.issues.map(i=>`${i.path.join(".")}: ${i.message}`).join("; ")},400);
    if(error instanceof AppError)return ok({error:error.message},error.status);
    const settings=configuration();let message=error instanceof Error?error.message:"Unknown error";
    for(const secret of [settings.geminiKey,settings.secretKey])if(secret)message=message.replaceAll(secret,"[redacted]");
    console.error("NEC Tutor:",message);
    const provider=/429|RESOURCE_EXHAUSTED/.test(message)?"Gemini’s usage limit has been reached. Try again later.":/503|UNAVAILABLE|high demand/.test(message)?"Gemini is temporarily busy. Please try your question again in a moment.":/API_KEY_INVALID|API key not valid|401|403/.test(message)?"The AI credentials were rejected. Check your Gemini API key in .env.local.":"The request could not finish. Check the local server output and try again.";
    return ok({error:provider},503);
  }
}
export {handle as GET,handle as POST,handle as PATCH,handle as DELETE};
