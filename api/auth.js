import { supabase, readJsonBody } from "./_supabase.js";
import { verifyPassword } from "./_auth.js";
import { signToken, verifyToken, nextMidnightEpochSeconds, makeCookie, clearCookie, parseCookie } from "./_session.js";

export default async function handler(req, res) {
  const action = req.query.action || "";
  const SESSION_SECRET = process.env.SESSION_SECRET || "";

  if (action === "login") {
    const body = await readJsonBody(req);
    const usuario = (body.usuario || "").trim().toLowerCase();
    const password = body.password || "";
    if (!usuario || !password) return res.status(400).json({ error: "Usuario y contraseña son obligatorios" });

    const db = supabase();
    const { data: user, error } = await db
      .from("usuarios")
      .select("*")
      .eq("usuario", usuario)
      .eq("activo", true)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
    }

    const exp = nextMidnightEpochSeconds();
    const payload = {
      id: user.id, usuario: user.usuario,
      nombre: user.nombre, apellido: user.apellido,
      nivel_aprobacion: user.nivel_aprobacion, exp,
    };
    const token = signToken(payload, SESSION_SECRET);
    res.setHeader("Set-Cookie", makeCookie(token, exp - Math.floor(Date.now() / 1000)));
    return res.status(200).json({ ok: true, ...payload });
  }

  if (action === "logout") {
    res.setHeader("Set-Cookie", clearCookie());
    return res.status(200).json({ ok: true });
  }

  if (action === "me") {
    const token = parseCookie(req.headers.cookie, "ocsys_token");
    const payload = verifyToken(token, SESSION_SECRET);
    if (!payload) return res.status(401).json({ error: "No autenticado" });
    return res.status(200).json(payload);
  }

  return res.status(400).json({ error: "Acción desconocida: " + action });
}
