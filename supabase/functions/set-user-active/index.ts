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
const banDuration = "876000h";

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
    const active = body.active;
    if (!uuidPattern.test(targetId) || typeof active !== "boolean") return json({ error: "Parâmetros inválidos" }, 400);
    if (targetId === callerAuth.user.id) return json({ error: "Você não pode alterar o próprio acesso" }, 403);

    const { data: target } = await admin.from("profiles").select("role,email,active,archived_at").eq("id", targetId).maybeSingle();
    if (!target || target.archived_at) return json({ error: "Usuário não encontrado ou arquivado" }, 404);
    if (target.role === "ceo" || String(target.email || "").toLowerCase() === (Deno.env.get("ADMIN_EMAIL") || "ogabrielmrossi@gmail.com").toLowerCase()) {
      return json({ error: "O perfil do CEO é protegido" }, 403);
    }

    if (target.active === active) {
      const { error } = await admin.auth.admin.updateUserById(targetId, { ban_duration: active ? "none" : banDuration });
      if (error) return json({ error: "Falha ao sincronizar o acesso de autenticação" }, 500);
      return json({ ok: true, active });
    }

    if (active) {
      const { error: unbanError } = await admin.auth.admin.updateUserById(targetId, { ban_duration: "none" });
      if (unbanError) return json({ error: "Falha ao reativar o acesso de autenticação" }, 500);
      const { error: dbError } = await callerClient.rpc("admin_set_profile_active", { p_target_id: targetId, p_active: true });
      if (dbError) {
        await admin.auth.admin.updateUserById(targetId, { ban_duration: banDuration });
        return json({ error: "Reativação cancelada sem liberar permissões: " + dbError.message }, 409);
      }
    } else {
      const { error: dbError } = await callerClient.rpc("admin_set_profile_active", { p_target_id: targetId, p_active: false });
      if (dbError) return json({ error: "Falha ao desativar permissões: " + dbError.message }, 409);
      const { error: banError } = await admin.auth.admin.updateUserById(targetId, { ban_duration: banDuration });
      if (banError) {
        await callerClient.rpc("admin_set_profile_active", { p_target_id: targetId, p_active: true });
        return json({ error: "Desativação cancelada porque a sessão não pôde ser bloqueada" }, 500);
      }
    }

    return json({ ok: true, active });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Erro inesperado" }, 500);
  }
});

