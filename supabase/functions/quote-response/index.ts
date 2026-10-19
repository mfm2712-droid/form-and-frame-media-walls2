import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
const headers={"Content-Type":"application/json","Cache-Control":"no-store","Access-Control-Allow-Origin":"https://form-and-frame.vercel.app","Access-Control-Allow-Headers":"content-type"};
const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async request=>{
 if(request.method==="OPTIONS")return new Response(null,{headers});
 if(request.method!=="POST")return respond({error:"Method not allowed"},405);
 let body;try{body=await request.json();}catch{return respond({error:"Invalid request"},400);}
 const token=String(body.token||"");const decision=String(body.decision||"");
 if(!/^[a-f0-9]{64}$/.test(token)||!["accepted","rejected"].includes(decision))return respond({error:"Invalid response"},400);
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token)))).map(x=>x.toString(16).padStart(2,"0")).join("");
 const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
 const result=await db.rpc("record_customer_quote_response",{p_token_hash:digest,p_decision:decision});
 if(result.error)return respond({error:"This link has expired, was already used, or cannot be processed."},409);
 return respond({ok:true,status:decision});
});
