import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {sha256} from './tracking/contracts.mjs';
import {refreshKiwify} from './tracking/adapters.mjs';
let runtimeKeys:any={};
export const env=(key:string)=>Deno.env.get(key)||runtimeKeys[key]||'';
export function guard(){
 if(env('TRACKING_ENVIRONMENT')==='pilot'){
  if(env('TRACKING_ENVIRONMENT_ID')!=='magemind-tracking-pilot-v1'||env('TRACKING_PROJECT_REF')!=='tsawxmlfvnvepzgcztfc'||env('SUPABASE_URL')!=='https://tsawxmlfvnvepzgcztfc.supabase.co'||env('TRACKING_FRONTEND_ORIGIN')!=='https://app.magemind.com.br')throw new Error('Invalid restricted pilot');return;
 }
 if(env('TRACKING_ENVIRONMENT')!=='test'||env('TRACKING_ENVIRONMENT_ID')!=='magemind-tracking-local-v1'||env('TRACKING_PROJECT_REF')!=='magemind-tracking-test')throw new Error('Test environment not identified');
 if((env('SUPABASE_URL')+env('TRACKING_FRONTEND_ORIGIN')+env('TRACKING_CALLBACK_ORIGIN')).includes('tsawxmlfvnvepzgcztfc')||env('TRACKING_FRONTEND_ORIGIN').includes('app.magemind.com.br'))throw new Error('Production forbidden');
 if(!['http://127.0.0.1:4173','http://localhost:4173'].includes(env('TRACKING_FRONTEND_ORIGIN')))throw new Error('Local frontend origin required');
}
export function service(){guard();return createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false}});}
export async function checkDatabase(db:any){const {data,error}=await db.rpc('tracking_environment_info');if(error||data?.id!==env('TRACKING_ENVIRONMENT_ID'))throw new Error('Database marker missing');if(env('TRACKING_ENVIRONMENT')==='pilot'){const keys=await db.rpc('tracking_runtime_keys');if(keys.error||!keys.data?.TRACKING_ENCRYPTION_KEY)throw new Error('Runtime keys unavailable');runtimeKeys=keys.data;}}
export async function userClient(req:Request){
 guard();const bearer=req.headers.get('authorization')||'';
 if(!bearer.startsWith('Bearer '))throw new Error('Unauthorized');
 const client=createClient(env('SUPABASE_URL'),env('SUPABASE_ANON_KEY'),{global:{headers:{Authorization:bearer}},auth:{persistSession:false}});
 const {data,error}=await client.auth.getUser();if(error||!data.user)throw new Error('Unauthorized');
 return {client,user:data.user};
}
export function json(req:Request,data:unknown,status=200){
 const origin=req.headers.get('origin')||'';
 return new Response(status===204?null:JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Origin':origin===env('TRACKING_FRONTEND_ORIGIN')?origin:env('TRACKING_FRONTEND_ORIGIN'),'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,GET,OPTIONS'}});
}
export async function body(req:Request){
 if(Number(req.headers.get('content-length')||0)>65536)throw new Error('Payload too large');
 const reader=req.body?.getReader();if(!reader)return {};
 const chunks=[];let length=0;
 while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>65536){await reader.cancel();throw new Error('Payload too large');}chunks.push(value);}
 const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 return JSON.parse(new TextDecoder().decode(bytes)||'{}');
}
function bytes(b64:string){return Uint8Array.from(atob(b64),c=>c.charCodeAt(0));}
export async function encrypt(value:unknown){
 const key=await crypto.subtle.importKey('raw',bytes(env('TRACKING_ENCRYPTION_KEY')),'AES-GCM',false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12)),out=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(value)));
 return btoa(String.fromCharCode(...iv))+'.'+btoa(String.fromCharCode(...new Uint8Array(out)));
}
export async function decrypt(value:string){
 const [a,b]=value.split('.');const key=await crypto.subtle.importKey('raw',bytes(env('TRACKING_ENCRYPTION_KEY')),'AES-GCM',false,['decrypt']);
 const out=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(a)},key,bytes(b));return JSON.parse(new TextDecoder().decode(out));
}
export async function credential(db:any,id:string){
 const {data,error}=await db.rpc('tracking_internal_credential',{i:id});if(error||!data||data.revoked_at)throw new Error('Credential revoked');
 let secrets=data.cipher?await decrypt(data.cipher):{};
 if(data.integration.provider==='kiwify'&&secrets.client_secret&&(!secrets.token_expires_at||secrets.token_expires_at<Date.now()+60000)){secrets=await refreshKiwify(secrets);const saved=await db.rpc('tracking_internal_save_credential',{i:id,p_cipher:await encrypt(secrets),p_hash:null});if(saved.error)throw saved.error;}
 return {row:data,secrets};
}
export async function requireMember(client:any,w:string,userId:string,write=false){
 const {data,error}=await client.from('tracking_members').select('role,can_view_buyers').eq('workspace_id',w).eq('user_id',userId).maybeSingle();
 if(error||!data||(write&&!['owner','admin'].includes(data.role)))throw new Error('Forbidden');return data;
}
export function allowReads(){if(env('TRACKING_ALLOW_EXTERNAL_READS')!=='true')throw new Error('External reads disabled; credentials and authorization required');}
export {sha256};
