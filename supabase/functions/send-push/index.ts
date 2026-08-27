import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
    if (!jwt) return json({ error: "Não autenticado" }, 401);

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: callerAuth, error: callerError } = await callerClient.auth.getUser(jwt);
    if (callerError || !callerAuth.user) return json({ error: "Sessão inválida" }, 401);

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }
    const notificationId = typeof body.notificationId === "string" ? body.notificationId : "";
    if (!uuidPattern.test(notificationId)) return json({ error: "Notificação inválida" }, 400);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: caller } = await admin.from("profiles")
      .select("active,archived_at").eq("id", callerAuth.user.id).maybeSingle();
    if (!caller || caller.active !== true || caller.archived_at) return json({ error: "Conta inativa" }, 403);

    const { data: notification } = await admin.from("notifications")
      .select("id,to_user_id,to_role,title,body,event_type,link_demand_id,created_by")
      .eq("id", notificationId).maybeSingle();
    if (!notification) return json({ error: "Notificação não encontrada" }, 404);
    if (notification.created_by !== callerAuth.user.id) return json({ error: "Notificação não pertence ao remetente" }, 403);

    let targetIds: string[] = [];
    if (notification.to_user_id) {
      targetIds = [notification.to_user_id];
    } else if (notification.to_role === "admin") {
      const { data: staff } = await admin.from("profiles").select("id")
        .in("role", ["ceo", "manager", "gestor", "editor"])
        .eq("active", true).is("archived_at", null);
      targetIds = (staff || []).map((profile) => profile.id);
    }
    if (!targetIds.length) return json({ ok: true, sent: 0, skipped: 0 });

    const { data: preferences } = await admin.from("notification_preferences").select("*").in("user_id", targetIds);
    const preferenceMap = new Map<string, Preference>((preferences || []).map((item) => [item.user_id, item as Preference]));
    const category = preferenceColumn(notification.event_type || "general");
    const eligibleIds = targetIds.filter((id) => {
      const pref = preferenceMap.get(id);
      return Boolean(pref?.push_enabled && pref[category]);
    });
    if (!eligibleIds.length) return json({ ok: true, sent: 0, skipped: targetIds.length });

    const { data: subscriptions } = await admin.from("push_subscriptions").select("id,user_id,endpoint,p256dh,auth")
      .in("user_id", eligibleIds).eq("enabled", true);
    if (!subscriptions?.length) return json({ ok: true, sent: 0, skipped: eligibleIds.length });

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
      await admin.from("push_deliveries").upsert({
        notification_id: notificationId,
        subscription_id: subscription.id,
        status: "pending",
        attempts: 1,
        last_error: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "notification_id,subscription_id" });

      const payload = JSON.stringify({
        title: notification.title,
        body: notification.body || "",
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

    return json({ ok: failed === 0, sent, failed, skipped });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Erro inesperado" }, 500);
  }
});
