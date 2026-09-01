import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";

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
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phoneDigits = (value: unknown) =>
  typeof value === "string" ? value.replace(/\D/g, "").slice(0, 15) : "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Não autenticado" }, 401);

    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: callerAuth, error: callerAuthError } = await callerClient.auth.getUser(jwt);
    if (callerAuthError || !callerAuth.user) return json({ error: "Sessão inválida" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: caller } = await admin.from("profiles").select("role,active,archived_at").eq("id", callerAuth.user.id).maybeSingle();
    if (!caller || caller.active !== true || caller.archived_at || !["ceo", "manager"].includes(caller.role)) {
      return json({ error: "Conta inativa ou sem permissão" }, 403);
    }

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }
    const targetId = typeof body.targetId === "string" ? body.targetId : "";
    const type = body.type === "client" || body.type === "team" ? body.type : "";
    const newEmail = typeof body.newEmail === "string" ? body.newEmail.trim().toLowerCase() : "";
    if (!uuidPattern.test(targetId) || !type || !emailPattern.test(newEmail) || newEmail.length > 320) {
      return json({ error: "Parâmetros inválidos" }, 400);
    }

    let authUserId: string | null = null;
    let currentClient: { status?: string } | null = null;
    if (type === "client") {
      const { data: client, error: clientError } = await admin.from("clients").select("status").eq("id", targetId).is("archived_at", null).maybeSingle();
      if (clientError || !client) return json({ error: "Cliente não encontrado" }, 404);
      currentClient = client;
      const { data: linked, error } = await admin.from("profiles").select("id").eq("client_id", targetId);
      if (error) return json({ error: "Falha ao consultar o acesso vinculado" }, 500);
      if ((linked || []).length > 1) return json({ error: "Mais de um acesso está vinculado a este cliente" }, 409);
      authUserId = linked?.[0]?.id || null;
    } else {
      authUserId = targetId;
    }

    let previousAuthEmail: string | null = null;
    let previouslyBanned = false;
    const patch = body.clientPatch && typeof body.clientPatch === "object"
      ? body.clientPatch as Record<string, unknown>
      : null;
    if (type === "client" && patch) {
      const rawPhone = typeof patch.phone === "string" ? patch.phone.trim() : "";
      const phone = phoneDigits(rawPhone);
      if (!phone) return json({ error: "Faltou informar o número de WhatsApp do cliente." }, 400);
      if (rawPhone !== phone || !/^\d{10,15}$/.test(phone)) {
        return json({ error: "O WhatsApp do cliente deve conter somente de 10 a 15 números." }, 400);
      }
      patch.phone = phone;
    }
    if (authUserId) {
      const { data: authRecord, error: authReadError } = await admin.auth.admin.getUserById(authUserId);
      if (authReadError || !authRecord.user) return json({ error: "Acesso de autenticação não encontrado" }, 404);
      previousAuthEmail = authRecord.user.email || null;
      previouslyBanned = Boolean(authRecord.user.banned_until && new Date(authRecord.user.banned_until).getTime() > Date.now());
      const authUpdate = type === "client"
        ? admin.auth.admin.updateUserById(authUserId, {
            email: newEmail,
            email_confirm: true,
            // O status do cliente e profiles.active bloqueiam dados via RLS.
            // Manter o Auth disponível permite exibir o motivo do bloqueio.
            ban_duration: "none",
          })
        : admin.auth.admin.updateUserById(authUserId, { email: newEmail, email_confirm: true });
      const { error: authUpdateError } = await authUpdate;
      if (authUpdateError) return json({ error: "Falha ao atualizar o e-mail de acesso: " + authUpdateError.message }, 409);
    }

    const syncOperation = type === "client" && patch
      ? callerClient.rpc("admin_update_client", {
          p_client_id: targetId,
          p_name: patch.name,
          p_email: newEmail,
          p_phone: patch.phone,
          p_status: patch.status,
          p_notes: patch.notes,
          p_customer_since: patch.customer_since,
          p_affiliate_id: patch.affiliate_id,
          p_plan_ids: patch.plan_ids,
        })
      : callerClient.rpc("admin_sync_identity_email", {
          p_target_id: targetId,
          p_type: type,
          p_new_email: newEmail,
        });
    const { error: syncError } = await syncOperation;
    if (syncError) {
      let rollbackFailed = false;
      if (authUserId && previousAuthEmail) {
        const rollback = type === "client"
          ? admin.auth.admin.updateUserById(authUserId, {
              email: previousAuthEmail,
              email_confirm: true,
              ban_duration: previouslyBanned ? "876000h" : "none",
            })
          : admin.auth.admin.updateUserById(authUserId, { email: previousAuthEmail, email_confirm: true });
        const { error } = await rollback;
        rollbackFailed = Boolean(error);
      }
      return json({
        error: rollbackFailed
          ? "Falha ao sincronizar o e-mail e a reversão do acesso exige revisão administrativa"
          : "Alteração cancelada sem divergência: " + syncError.message,
      }, rollbackFailed ? 500 : 409);
    }

    return json({ ok: true, email: newEmail, public_only: !authUserId });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Erro inesperado" }, 500);
  }
});
