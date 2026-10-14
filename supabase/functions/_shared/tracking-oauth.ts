import {env,decrypt} from './tracking-runtime.ts';
// Called only after getUser(); the database also validates auth.sessions.
export function sessionId(req:Request){
 const part=(req.headers.get('authorization')||'').slice(7).split('.')[1];
 try{const claims=JSON.parse(atob(part.replaceAll('-','+').replaceAll('_','/')));if(!/^[0-9a-f-]{36}$/i.test(claims.session_id))throw 0;return claims.session_id;}catch{throw new Error('Unauthorized');}
}
export async function metaConfig(db:any){
 const {data,error}=await db.rpc('tracking_platform_internal');if(error)throw error;
 const secret=data?.secret_cipher?await decrypt(data.secret_cipher):null;
 const config={clientId:data?.app_id||env('TRACKING_META_CLIENT_ID'),clientSecret:secret?.clientSecret||env('TRACKING_META_CLIENT_SECRET'),configId:data?.config_id||env('TRACKING_META_CONFIG_ID'),version:data?.api_version||env('TRACKING_META_VERSION')||'v25.0',allowManagement:data?.allow_management!==false,redirectUri:env('TRACKING_CALLBACK_ORIGIN')+'/functions/v1/tracking-api?callback=meta'};
 if(!config.clientId||!config.clientSecret)throw new Error('O login da Meta ainda precisa ser configurado pelo administrador master.');return config;
}
