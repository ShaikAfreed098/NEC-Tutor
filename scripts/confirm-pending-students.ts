import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { db } from "../src/lib/auth";

// One-time cutover for existing NEC Tutor students after disabling email verification.
const service=db(undefined,true);
let confirmed=0;
for(let page=1;;page++){
  const result=await service.auth.admin.listUsers({page,perPage:1000});
  if(result.error)throw new Error("Could not check existing student accounts.");
  const pending=result.data.users.filter(u=>u.email && !u.email_confirmed_at);
  if(pending.length){
    const profiles=await service.from("profiles").select("id").eq("role","student").in("id",pending.map(u=>u.id));
    if(profiles.error)throw new Error("Could not check existing student profiles.");
    const ids=new Set((profiles.data || []).map(p=>p.id));
    for(const user of pending.filter(u=>ids.has(u.id))){
      const updated=await service.auth.admin.updateUserById(user.id,{email_confirm:true});
      if(updated.error || !updated.data.user?.email_confirmed_at)throw new Error("Could not complete email-verification cutover.");
      confirmed++;
    }
  }
  if(result.data.users.length<1000)break;
}
console.log(JSON.stringify({existingStudentsConfirmed:confirmed,passwordsUnchanged:true}));
