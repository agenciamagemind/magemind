import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-dispatch-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Preference = {
  user_id: string;
  push_enabled: boolean;
  demand_updates: boolean;
  comments: boolean;
  sales: boolean;
  team_activity: boolean;
  general: boolean;
};

function preferenceColumn(eventType: string): keyof Omit<Preference, "user_id" | "push_enabled"> {
  if (eventType.startsWith("demand_")) return "demand_updates";
  if (eventType.startsWith("comment_")) return "comments";
  if (eventType.startsWith("sale_")) return "sales";
  if (eventType.startsWith("team_")) return "team_activity";
  return "general";
}

function compactPushText(value: unknown, max: number, fallback = ""): string {
  const normalized = String(value || fallback).replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  const sentences = normalized.match(/[^.!?]+[.!?]+/g) || [];
  let complete = "";
  for (const sentence of sentences) {
    const candidate = (complete + " " + sentence.trim()).trim();
    if (candidate.length > max) break;
    complete = candidate;
  }
  if (complete.length >= Math.floor(max * 0.4)) return complete;
  const slice = normalized.slice(0, max - 1).trimEnd();
  const boundary = slice.lastIndexOf(" ");
  const cut = boundary >= Math.floor(max * 0.58) ? slice.slice(0, boundary) : slice;
  return cut.replace(/[\s.,;:!?-]+$/, "") + "…";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY") || "";
    const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY") || "";
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:contato@magemind.com.br";
    if (!vapidPublic || !vapidPrivate) return json({ error: "Web Push não configurado" }, 503);

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt&&!req.headers.get("x-dispatch-token")) return json({ error: "Não autenticado" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const dispatchToken=req.headers.get('x-dispatch-token')||'';
    let trustedDispatcher=false;
    let callerId:string|null=null;
    if(dispatchToken){
      const {data,error}=await admin.rpc('validate_push_dispatch_token',{p_token:dispatchToken});
      if(error||data!==true)return json({error:'Dispatcher inválido'},401);
      trustedDispatcher=true;
    }else{
      const callerClient=createClient(supabaseUrl,anonKey,{global:{headers:{Authorization:authHeader}}});
      const {data,error}=await callerClient.auth.getUser(jwt);
      if(error||!data.user)return json({error:'Sessão inválida'},401);
      callerId=data.user.id;
      const {data:caller}=await admin.from('profiles').select('active,archived_at').eq('id',callerId).maybeSingle();
      if(!caller||!caller.active||caller.archived_at)return json({error:'Conta inativa'},403);
    }

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }
    const notificationId = typeof body.notificationId === "string" ? body.notificationId : "";
    if (!uuidPattern.test(notificationId)) return json({ error: "Notificação inválida" }, 400);


    const { data: notification } = await admin.from("notifications")
      .select("id,to_user_id,to_role,title,body,event_type,link_demand_id,created_by,dedupe_key")
      .eq("id", notificationId).maybeSingle();
    if (!notification) return json({ error: "Notificação não encontrada" }, 404);
    if (!trustedDispatcher&&notification.created_by !== callerId) return json({ error: "Notificação não pertence ao remetente" }, 403);
    const finish=async(result:Record<string,unknown>)=>{
      const {error}=await admin.rpc('complete_notification_push',{p_id:notificationId,p_error:Number(result.failed||0)>0?'Uma ou mais entregas aguardam nova tentativa':null});
      if(error)throw error;
      return json(result);
    };
    if(notification.event_type==='sale_payment_pending'){
      const {data:profile,error:profileError}=await admin.from('profiles').select('client_id').eq('id',notification.to_user_id).single();
      if(profileError)throw profileError;
      const {data:pending,error:pendingError}=await admin.from('sales').select('value').eq('client_id',profile.client_id).eq('status','Pendente');
      if(pendingError)throw pendingError;
      const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
      const day=['year','month','day'].map(t=>parts.find(p=>p.type===t)?.value).join('-');
      if(!pending?.length||notification.dedupe_key!=='payment:'+day)return finish({ok:true,sent:0,skipped:1});
      const total=pending.reduce((sum,row)=>sum+Math.round(Number(row.value)*100),0)/100;
      notification.body='Pagamento pendente: '+new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(total)+'. Fale com a Magemind no WhatsApp.';
    }

    let linkedAssigneeId: string | null = null;
    if (notification.link_demand_id) {
      const { data: demand } = await admin.from("demands").select("assignee_id")
        .eq("id", notification.link_demand_id).maybeSingle();
      linkedAssigneeId = demand?.assignee_id || null;
    }

    let targetIds: string[] = [];
    if (notification.to_user_id) {
      const { data: target } = await admin.from("profiles").select("id,role")
        .eq("id", notification.to_user_id).eq("active",true).is("archived_at",null).maybeSingle();
      if (target && (target.role !== "editor" || target.id === linkedAssigneeId)) targetIds = [target.id];
    } else if (notification.to_role === "admin") {
      const { data: staff } = await admin.from("profiles").select("id,role")
        .in("role", ["ceo", "manager", "gestor", "editor"])
        .eq("active", true).is("archived_at", null);
      targetIds = (staff || [])
        .filter((profile) => profile.role !== "editor" || profile.id === linkedAssigneeId)
        .map((profile) => profile.id);
    }
    if (!targetIds.length) return finish({ ok: true, sent: 0, skipped: 0 });

    const { data: preferences,error:preferencesError } = await admin.from("notification_preferences").select("*").in("user_id", targetIds);
    if(preferencesError)throw preferencesError;
    const preferenceMap = new Map<string, Preference>((preferences || []).map((item) => [item.user_id, item as Preference]));
    const category = preferenceColumn(notification.event_type || "general");
    const eligibleIds = targetIds.filter((id) => {
      const pref = preferenceMap.get(id);
      return Boolean(pref?.push_enabled && pref[category]);
    });
    if (!eligibleIds.length) return finish({ ok: true, sent: 0, skipped: targetIds.length });

    const { data: subscriptions,error:subscriptionsError } = await admin.from("push_subscriptions").select("id,user_id,endpoint,p256dh,auth")
      .in("user_id", eligibleIds).eq("enabled", true);
    if(subscriptionsError)throw subscriptionsError;
    if (!subscriptions?.length) return finish({ ok: true, sent: 0, skipped: eligibleIds.length });

    const subscriptionIds = subscriptions.map((subscription) => subscription.id);
    const { data: completed } = await admin.from("push_deliveries").select("subscription_id")
      .eq("notification_id", notificationId).eq("status", "sent").in("subscription_id", subscriptionIds);
    const completedIds = new Set((completed || []).map((item) => item.subscription_id));

    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
    let sent = 0;
    let failed = 0;
    let skipped = completedIds.size;

    await Promise.all(subscriptions.map(async (subscription) => {
      if (completedIds.has(subscription.id)) return;
      const {data:claimed,error:claimError}=await admin.rpc('claim_push_delivery',{p_notification_id:notificationId,p_subscription_id:subscription.id});
      if(claimError)throw claimError;
      if(!claimed){
        const {data:delivery}=await admin.from('push_deliveries').select('status').eq('notification_id',notificationId).eq('subscription_id',subscription.id).single();
        if(delivery?.status==='sent'||delivery?.status==='expired')skipped+=1;else failed+=1;
        return;
      }

      const payload = JSON.stringify({
        title: compactPushText(notification.title, 28, "Magemind"),
        body: compactPushText(notification.body, 72),
        notificationId,
        demandId: notification.link_demand_id,
        url: notification.link_demand_id ? `./?openDemand=${notification.link_demand_id}` : "./",
      });
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, payload, { TTL: 86400, urgency: "normal" });
        sent += 1;
        await admin.from("push_deliveries").update({
          status: "sent", sent_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }).eq("notification_id", notificationId).eq("subscription_id", subscription.id);
      } catch (error) {
        failed += 1;
        const statusCode = Number((error as { statusCode?: number }).statusCode || 0);
        const expired = statusCode === 404 || statusCode === 410;
        const message = error instanceof Error ? error.message.slice(0, 500) : "Falha no provedor Web Push";
        await admin.from("push_deliveries").update({
          status: expired ? "expired" : "failed",
          last_error: message,
          updated_at: new Date().toISOString(),
        }).eq("notification_id", notificationId).eq("subscription_id", subscription.id);
        if (expired) await admin.from("push_subscriptions").update({ enabled: false }).eq("id", subscription.id);
      }
    }));

    return finish({ ok: failed === 0, sent, failed, skipped });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Erro inesperado" }, 500);
  }
});
