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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const protectedEmail = (Deno.env.get("ADMIN_EMAIL") || "ogabrielmrossi@gmail.com").toLowerCase();
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Não autenticado" }, 401);

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: callerAuth, error: callerAuthError } = await callerClient.auth.getUser(jwt);
    if (callerAuthError || !callerAuth.user) return json({ error: "Sessão inválida" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: callerProfile, error: callerProfileError } = await admin
      .from("profiles")
      .select("role")
      .eq("id", callerAuth.user.id)
      .maybeSingle();
    if (callerProfileError || !callerProfile || !["ceo", "manager"].includes(callerProfile.role)) {
      return json({ error: "Somente CEO ou Gerente podem excluir contas" }, 403);
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ error: "JSON inválido" }, 400);
    }

    const targetId = typeof body.targetId === "string" ? body.targetId : "";
    const type = body.type;
    if (!uuidPattern.test(targetId) || !["team", "client"].includes(String(type))) {
      return json({ error: "Parâmetros inválidos" }, 400);
    }
    if (targetId === callerAuth.user.id) {
      return json({ error: "Você não pode excluir a própria conta" }, 403);
    }

    if (type === "team") {
      const { data: target, error: targetError } = await admin
        .from("profiles")
        .select("id, role, email")
        .eq("id", targetId)
        .maybeSingle();
      if (targetError) return json({ error: "Falha ao consultar usuário: " + targetError.message }, 500);
      if (!target) return json({ error: "Usuário de equipe não encontrado" }, 404);

      const isProtected = target.role === "ceo" || String(target.email || "").toLowerCase() === protectedEmail;
      if (isProtected) return json({ error: "O perfil do CEO é protegido" }, 403);

      // Afiliados com movimentacao financeira sao arquivados. O perfil fica
      // inativo, sai da operacao e os lancamentos permanecem auditaveis.
      if (target.role === "affiliate") {
        const [{ count: commissionCount, error: commissionError }, { count: withdrawalCount, error: withdrawalError }] = await Promise.all([
          admin.from("affiliate_commissions").select("id", { count: "exact", head: true }).eq("affiliate_id", targetId),
          admin.from("affiliate_withdrawals").select("id", { count: "exact", head: true }).eq("affiliate_id", targetId),
        ]);
        if (commissionError || withdrawalError) {
          return json({ error: "Falha ao verificar o histórico financeiro do afiliado" }, 500);
        }
        if ((commissionCount || 0) > 0 || (withdrawalCount || 0) > 0) {
          const { error: unlinkError } = await admin.from("clients").update({ affiliate_id: null }).eq("affiliate_id", targetId);
          if (unlinkError) return json({ error: "Falha ao desvincular os clientes do afiliado: " + unlinkError.message }, 409);
          const { error: archiveError } = await admin.from("profiles").update({ active: false, archived_at: new Date().toISOString() }).eq("id", targetId);
          if (archiveError) return json({ error: "Falha ao arquivar o afiliado: " + archiveError.message }, 500);
          return json({ ok: true, archived: true, preserved_history: true });
        }
      }

      // Deleting Auth first is failure-safe: the FK cascade removes profiles,
      // notifications/sessions and sets demand assignee/creator fields to null.
      // Comments and demands remain as company history.
      const { error: deleteError } = await admin.auth.admin.deleteUser(targetId);
      if (deleteError) return json({ error: "Não foi possível excluir esta conta. Desative o acesso e verifique os vínculos históricos antes de tentar novamente." }, 409);

      return json({ ok: true, preserved_history: true });
    }

    const { data: client, error: clientError } = await admin
      .from("clients")
      .select("id")
      .eq("id", targetId)
      .maybeSingle();
    if (clientError) return json({ error: "Falha ao consultar cliente: " + clientError.message }, 500);
    if (!client) return json({ error: "Cliente não encontrado" }, 404);

    const { data: linkedProfiles, error: linkedError } = await admin
      .from("profiles")
      .select("id, role, email")
      .eq("client_id", targetId);
    if (linkedError) return json({ error: "Falha ao consultar acesso do cliente: " + linkedError.message }, 500);
    if ((linkedProfiles || []).length > 1) {
      return json({ error: "Mais de um acesso está vinculado a este cliente; exclusão interrompida para preservar dados" }, 409);
    }

    const linked = linkedProfiles?.[0];
    if (linked) {
      const linkedProtected = linked.role === "ceo" || String(linked.email || "").toLowerCase() === protectedEmail;
      if (linkedProtected) return json({ error: "O perfil do CEO é protegido" }, 403);
      const { error: authDeleteError } = await admin.auth.admin.deleteUser(linked.id);
      if (authDeleteError) return json({ error: "Falha ao remover acesso do cliente: " + authDeleteError.message }, 500);
    }

    // The schema cascades only data that belongs to this exact client.
    const { error: deleteClientError } = await admin.from("clients").delete().eq("id", targetId);
    if (deleteClientError) return json({ error: "Falha ao excluir cliente: " + deleteClientError.message }, 500);

    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Erro inesperado" }, 500);
  }
});

