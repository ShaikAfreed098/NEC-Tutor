import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { db } from "../src/lib/auth";
import { DATA_DIR } from "../src/lib/local-store";
import type { Profile, Ticket, Message } from "../src/lib/types";

const base="http://127.0.0.1:3000/api/";
const service=db(undefined,true);
const email=`update-check.${randomBytes(5).toString("hex")}@nec-tutor.example`;
const password=`VerifyTutor!${randomBytes(6).toString("hex")}9`;
let userId:string|undefined;
const results:Record<string,unknown>={};
async function api<T>(endpoint:string, token:string|undefined, body?:unknown, method=body?"POST":"GET"):Promise<T>{
  const response=await fetch(base+endpoint,{method,headers:{"Content-Type":"application/json",Origin:"http://127.0.0.1:3000",...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});
  const value=await response.json();if(!response.ok)throw new Error(`${endpoint}: ${value.error || response.status}`);return value as T;
}
try{
  await api("signup",undefined,{email,password,name:"Temporary update check",role:"admin"});
  const signed=await db().auth.signInWithPassword({email,password});
  assert.ifError(signed.error);assert.ok(signed.data.session);userId=signed.data.user!.id;
  const token=signed.data.session.access_token;
  const profile=await api<Profile>("profile",token);assert.equal(profile.role,"student");
  const user=await service.auth.admin.getUserById(userId);assert.ok(user.data.user?.email_confirmed_at);
  results.immediateSignupWithoutEmailVerification=true;results.signupRoleRemainsStudent=true;
  const forbidden=await fetch(base+"admin/local-documents",{headers:{Authorization:`Bearer ${token}`}});assert.equal(forbidden.status,403);
  const staff=JSON.parse(await fs.readFile(path.join(DATA_DIR,"staff-demo-login.json"),"utf8"));
  const staffSigned=await db().auth.signInWithPassword({email:staff.email,password:staff.password});assert.ifError(staffSigned.error);assert.ok(staffSigned.data.session);
  const staffToken=staffSigned.data.session.access_token;
  assert.equal((await api<Profile>("profile",staffToken)).role,"admin");
  await api("admin/local-documents",staffToken);results.staffDemoAccess=true;
  const ticket=await api<Ticket>("tickets",token,{question:"Temporary check: please confirm the real examination timetable.",conversationId:null});
  await api(`tickets/${ticket.id}/replies`,staffToken,{content:"This is a verification reply. Demo dates are sample data; consult your college for real dates."});
  const updated=(await api<Ticket[]>("tickets",token)).find(t=>t.id===ticket.id);assert.equal(updated?.replies.length,1);results.staffReplyVisibleToStudent=true;
  const exam=await api<{conversationId:string;message:Message}>("chat",token,{question:"When is the Java examination?",subject:"programming",unit:4,conversationId:null});
  assert.match(exam.message.content,/demo|sample/i);assert.match(exam.message.content,/19/);assert.match(exam.message.content,/October|Oct/i);assert.match(exam.message.content,/2026/);
  assert.ok(exam.message.sources.some(s=>s.subject==="academic"));assert.equal(exam.message.needsEscalation,false);
  results.examAnswerAcrossSubjectAndUnit=exam.message;
  const chosen=await api<{message:Message}>("chat",token,{question:"What is my exam date?",subject:"chemistry",unit:5,conversationId:null});
  assert.match(chosen.message.content,/20/);assert.match(chosen.message.content,/demo|sample/i);assert.match(chosen.message.content,/10/);assert.equal(chosen.message.needsEscalation,false);
  results.selectedCourseExamAnswer=chosen.message;
  await fs.writeFile(path.join(DATA_DIR,"update-verification.json"),JSON.stringify(results,null,2));
  console.log(JSON.stringify(results,null,2));
}finally{
  if(!userId){const list=await service.auth.admin.listUsers({page:1,perPage:1000});userId=list.data.users?.find(u=>u.email===email)?.id;}
  if(userId){
    const tickets=await service.from("tickets").delete().eq("user_id",userId);assert.ifError(tickets.error);
    const removed=await service.auth.admin.deleteUser(userId);assert.ifError(removed.error);
  }
}
