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

const cleanText = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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
    .select("role,active,archived_at")
    .eq("id", callerAuth.user.id)
    .maybeSingle();

  if (callerProfileError || !callerProfile || callerProfile.active !== true || callerProfile.archived_at || !["ceo", "manager"].includes(callerProfile.role)) {
    return json({ error: "Sem permissão para criar clientes" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const name = cleanText(body.name, 160);
  const email = cleanText(body.email, 320).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  const phone = cleanText(body.phone, 40);
  const status = cleanText(body.status, 30) || "Ativo";
  const notes = cleanText(body.notes, 3000);
  const type = cleanText(body.type, 60) || "Mensal";
  const planIds = Array.isArray(body.plan_ids) ? [...new Set(body.plan_ids.filter((id): id is string => typeof id === "string"))] : [];
  const affiliateId = typeof body.affiliate_id === "string" && body.affiliate_id ? body.affiliate_id : null;
  const customerSince = body.customer_since || null;

  if (!name || !email || !password) return json({ error: "Nome, e-mail e senha são obrigatórios" }, 400);
  if (password.length < 8) return json({ error: "A senha deve ter ao menos 8 caracteres" }, 400);
  if (planIds.some((id) => !uuidPattern.test(id)) || (affiliateId && !uuidPattern.test(affiliateId))) {
    return json({ error: "Plano ou afiliado inválido" }, 400);
  }

  const { data: clientRow, error: clientError } = await callerClient.rpc("admin_create_client_record", {
    p_name: name,
    p_email: email,
    p_phone: phone,
    p_status: status,
    p_notes: notes,
    p_type: type,
    p_customer_since: customerSince,
    p_affiliate_id: affiliateId,
    p_plan_ids: planIds,
  });

  const createdClient = Array.isArray(clientRow) ? clientRow[0] : clientRow;
  if (clientError || !createdClient) return json({ error: clientError?.message || "Falha ao criar cliente" }, 400);

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, phone },
    app_metadata: { source: "managed_client", role: "client", client_id: createdClient.id },
  });

  if (authError || !authData.user) {
    await admin.from("clients").delete().eq("id", createdClient.id);
    return json({ error: authError?.message || "Falha ao criar acesso do cliente" }, 400);
  }

  const userId = authData.user.id;
  const av = name.split(/\s+/).map((word) => word[0]).join("").slice(0, 2).toUpperCase();
  const { error: profileError } = await admin.from("profiles").upsert({
    id: userId,
    name,
    email,
    phone,
    role: "client",
    av,
    active: status !== "Inativo",
    client_id: createdClient.id,
  }, { onConflict: "id" });

  if (profileError) {
    await admin.auth.admin.deleteUser(userId);
    await admin.from("clients").delete().eq("id", createdClient.id);
    return json({ error: "Falha ao criar perfil: " + profileError.message }, 500);
  }

  if (status === "Inativo") {
    const { error: banError } = await admin.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
    if (banError) {
      await admin.auth.admin.deleteUser(userId);
      await admin.from("clients").delete().eq("id", createdClient.id);
      return json({ error: "Falha ao bloquear o acesso do cliente inativo" }, 500);
    }
  }

  await Promise.all([
    admin.from("notifications").insert({
      to_user_id: userId,
      icon: "🎉",
      icon_bg: "var(--emeraldbg)",
      title: "Bem-vindo ao Magemind!",
      body: "Sua conta foi criada. Acesse o sistema para ver suas demandas.",
    }),
    admin.from("notifications").insert({
      to_role: "admin",
      icon: "👤",
      icon_bg: "var(--pinkbg)",
      title: "Novo cliente cadastrado",
      body: `${name} foi adicionado ao sistema.`,
    }),
    admin.from("activity").insert({
      icon: "👤",
      bg: "var(--pinkbg)",
      text: `Cliente cadastrado: ${name}`,
    }),
  ]);

  return json({ ok: true, client: createdClient, user_id: userId });
});

