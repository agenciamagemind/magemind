(() => {
 const cfg=window.MAGEMIND_TRACKING_ENV;if(!['supabase-local','supabase-pilot'].includes(cfg?.mode))return;
 if(cfg.mode==='supabase-local'&&(cfg.supabaseUrl!=='http://127.0.0.1:55431'||cfg.projectRef!=='magemind-tracking-test'||!cfg.supabaseAnonKey))throw new Error('Supabase local config mismatch');
 const client=supa;
 const checked=r=>{if(r.error)throw new Error(r.error.message);return r.data;};
 const rpc=async(name,args)=>checked(await client.rpc(name,args));
 const edge=async(data)=>{const r=await client.functions.invoke('tracking-api',{body:data});if(r.error){let message;try{message=(await r.error.context.json()).error;}catch{}throw new Error(message||'Não foi possível concluir a conexão. Tente novamente.');}return r.data;};
 window.MagemindTrackingBackend={
  client,
  edge,
  subscription:null,
  subscribe(w,callback){if(this.subscription)client.removeChannel(this.subscription);clearTimeout(this.refreshTimer);const update=()=>{clearTimeout(this.refreshTimer);this.refreshTimer=setTimeout(callback,500);};const scope=w==='observer'?{}:{filter:'workspace_id=eq.'+w};this.subscription=w?client.channel('tracking-'+w).on('postgres_changes',{event:'*',schema:'public',table:'tracking_order_events',...scope},update).on('postgres_changes',{event:'*',schema:'public',table:'tracking_ad_stats_daily',...scope},update).subscribe():null;},
  async call(route,data,params,state){
   const w=state.workspace,p={...state,...params,action:route.slice(1)};
   if(route==='/auth/me'){const r=await client.auth.getUser();return r.error?{authenticated:false}:{user_id:r.data.user.id,email:r.data.user.email};}
   if(route==='/auth/signup'||route==='/auth/login'){
    const r=route.endsWith('signup')?await client.auth.signUp({email:data.email,password:data.password,options:{data:{name:data.name},emailRedirectTo:location.origin+'/tracking.html'}}):await client.auth.signInWithPassword({email:data.email,password:data.password});
    checked(r);if(!r.data.session)throw new Error('Confirme a conta no e-mail de teste do inbucket local.');return {user_id:r.data.user.id,email:r.data.user.email};
   }
   if(route==='/auth/logout'){checked(await client.auth.signOut());return {ok:true};}
   if(route.startsWith('/admin/'))return rpc('tracking_admin_report',{p:{...p,action:route.slice(7)}});
   if(route==='/workspaces'){
    if(data)return {id:await rpc('tracking_create_workspace',{p_name:data.name,p_currency:data.currency||'BRL',p_timezone:data.timezone||'America/Sao_Paulo'})};
    const uid=(await client.auth.getUser()).data.user?.id;if(!uid)return [];
    const members=checked(await client.from('tracking_members').select('workspace_id,role,can_view_buyers').eq('user_id',uid));
    const rows=checked(await client.from('tracking_workspaces').select('*').order('created_at'));
    return rows.map(x=>({...x,...members.find(m=>m.workspace_id===x.id)}));
   }
   if(['/summary','/list/orders','/order','/list/customers','/customer','/list/ads','/ad-options','/funnel','/diagnostics','/settings','/notifications','/export'].includes(route))return rpc('tracking_report',{w,p});
   if(route==='/ad-management')return rpc('tracking_ad_management',{w,f:state.from,t:state.to,cur:state.currency});
   if(route==='/ad-status'){if(cfg.mode==='supabase-pilot'&&!state.simulation_only){const rows=checked(await client.from('tracking_integrations').select('id').eq('workspace_id',w).eq('provider',data.provider).eq('account_id',data.account_id).eq('connected',true).single());return edge({action:'ad_status',workspace:w,integration:rows.id,entity_id:data.entity_id,status:data.status,revision:data.revision});}return rpc('tracking_set_ad_status',{w,provider_name:data.provider,account:data.account_id,entity:data.entity_id,target_status:data.status,expected_revision:data.revision});}
   if(route==='/onboarding')return rpc('tracking_onboarding_status',{w});
   if(route==='/dashboard')return rpc('tracking_dashboard_report',{w,f:state.from,t:state.to,cur:state.currency});
   if(route==='/dashboard-layout')return rpc('tracking_dashboard_layout',{w,d:data?.device||params.device,p:data?.layout||null,expected_revision:data?.revision??null});
   if(route==='/onboarding/celebrate')return {claimed:await rpc('tracking_onboarding_celebrate',{w})};
   if(route==='/cost-products')return rpc('tracking_cost_products',{w});
   if(route==='/costs/edit')return {id:await rpc('tracking_update_cost',{w,c:data.id,p:data})};
   if(route==='/costs/archive')return rpc('tracking_archive_cost',{w,c:data.id});
   if(['/integrations','/sites','/costs'].includes(route)&&!data)return checked(await client.from({integrations:'tracking_integrations',sites:'tracking_sites',costs:'tracking_cost_rules'}[route.slice(1)]).select('*').eq('workspace_id',w).order(route==='/sites'?'id':'created_at'));
   if(route==='/integration/token')return edge({workspace:w,integration:data.id,action:'api_token'});
   if(route==='/integration/disconnect')return rpc('tracking_disconnect',{w,i:data.id});
   if(route==='/integration/products')return rpc('tracking_select_products',{w,i:data.id,ids:data.ids});
   if(route==='/integration/sync')return edge({workspace:w,integration:data.id,action:'queue_sync'});
   if(route==='/sites')return {id:await rpc('tracking_save_site',{w,p_domain:data.domain,p_checkout_domains:data.checkout_domains.split(',').map(x=>x.trim()).filter(Boolean)})};
   if(route==='/costs')return {id:await rpc('tracking_save_cost',{w,p:data})};
   if(route==='/settings')return rpc('tracking_update_workspace',{w,p_name:data.name,p_days:data.attribution_days,p_retention:data.retention_days});
   if(route==='/customers/anonymize')return rpc('tracking_anonymize_customer',{w,c:data.id});
   if(route==='/preferences'){
    const uid=(await client.auth.getUser()).data.user?.id;
    return checked(await client.from('tracking_notification_preferences').upsert({...data,workspace_id:w,user_id:uid},{onConflict:'workspace_id,user_id'}));
   }
   if(route==='/retry')return rpc('tracking_retry',{w,e:data.id});
   throw new Error('Ação indisponível neste ambiente');
  }
 };
 client.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT')document.dispatchEvent(new Event('magemind:tracking-signed-out'));});
})();
