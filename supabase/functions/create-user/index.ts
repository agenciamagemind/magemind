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

const creatableRoles = ["manager", "gestor", "editor"];
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const canCreateRole = (callerRole: string, role: string) => {
  if (["ceo", "manager"].includes(callerRole)) return creatableRoles.includes(role);
  return callerRole === "gestor" && role === "editor";
};
const phoneDigits = (value: unknown) =>
  typeof value === "string" ? value.replace(/\D/g, "").slice(0, 15) : "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Não autenticado" }, 401);

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: callerAuth, error: callerAuthError } = await callerClient.auth.getUser(jwt);
  if (callerAuthError || !callerAuth.user) return json({ error: "Sessão inválida" }, 401);

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: callerProfile } = await admin
    .from("profiles")
    .select("role,active,archived_at")
    .eq("id", callerAuth.user.id)
    .maybeSingle();
  if (!callerProfile || callerProfile.active !== true || callerProfile.archived_at) {
    return json({ error: "Conta inativa ou sem permissão" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 160) : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 320) : "";
  const password = typeof body.password === "string" ? body.password : "";
  const rawPhone = typeof body.phone === "string" ? body.phone.trim().slice(0, 40) : "";
  const phone = phoneDigits(rawPhone);
  const role = typeof body.role === "string" ? body.role : "";
  const commissionRate = 0;
  const active = body.active !== false;

  if (!name) return json({ error: "Faltou informar o nome do usuário." }, 400);
  if (!email) return json({ error: "Faltou informar o e-mail do usuário." }, 400);
  if (!emailPattern.test(email)) return json({ error: "O e-mail do usuário parece incompleto. Confira e tente de novo." }, 400);
  if (!password) return json({ error: "Faltou definir a senha provisória." }, 400);
  if (!role) return json({ error: "Faltou selecionar o cargo do usuário." }, 400);
  if (rawPhone && (rawPhone !== phone || !/^\d{10,15}$/.test(phone))) {
    return json({ error: "O WhatsApp deve conter somente de 10 a 15 números." }, 400);
  }
  if (password.length < 8) return json({ error: "A senha deve ter ao menos 8 caracteres" }, 400);
  if (!canCreateRole(callerProfile.role, role)) return json({ error: "Sem permissão para criar este cargo" }, 403);
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, phone },
    app_metadata: { source: "internal", role },
  });

  if (createError || !created.user) return json({ error: createError?.message || "Falha ao criar usuário" }, 400);

  const userId = created.user.id;
  const av = name.split(/\s+/).map((word) => word[0]).join("").slice(0, 2).toUpperCase();
  const { error: profileError } = await admin.from("profiles").upsert({
    id: userId,
    name,
    email,
    phone: phone || null,
    role,
    av,
    active,
    client_id: null,
    commission_rate: commissionRate,
  }, { onConflict: "id" });

  if (profileError) {
    await admin.auth.admin.deleteUser(userId);
    return json({ error: "Falha ao gravar perfil: " + profileError.message }, 500);
  }

  if (!active) {
    const { error: banError } = await admin.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
    if (banError) {
      await admin.auth.admin.deleteUser(userId);
      return json({ error: "Falha ao criar o usuário com acesso bloqueado" }, 500);
    }
  }

  return json({ user_id: userId, active });
});
