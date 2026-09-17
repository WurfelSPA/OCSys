import { createHash } from "node:crypto";
import { supabase, readJsonBody } from "./_supabase.js";
import { verifyPassword, hashPassword } from "./_auth.js";
import { signToken, verifyToken, computeExpiry, makeCookie, clearCookie, parseCookie } from "./_session.js";
import { enviarCorreoResetPassword } from "./_email.js";

// Huella corta del hash de contraseña vigente -- se guarda dentro del token
// de reset para que deje de servir apenas la contraseña cambia (por este
// mismo flujo o por cualquier otro), sin necesitar una tabla de tokens.
function pwVersion(passwordHash) {
  return createHash("sha256").update(passwordHash || "").digest("hex").slice(0, 16);
}

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

    const exp = computeExpiry();
    const payload = {
      id: user.id, usuario: user.usuario,
      nombre: user.nombre, apellido: user.apellido,
      nivel_aprobacion: user.nivel_aprobacion, exp,
    };
    const token = signToken(payload, SESSION_SECRET);
    res.setHeader("Set-Cookie", makeCookie(token, exp - Math.floor(Date.now() / 1000)));
    return res.status(200).json({ ok: true, ...payload });
  }

  if (action === "solicitar-reset") {
    const body = await readJsonBody(req);
    const usuario = (body.usuario || "").trim().toLowerCase();
    const respuesta = { ok: true, mensaje: "Si el usuario existe, te enviaremos un enlace a tu correo para restablecer tu contraseña." };
    if (!usuario) return res.status(400).json({ error: "Ingresa tu usuario" });

    const db = supabase();
    const { data: user } = await db.from("usuarios").select("*").eq("usuario", usuario).eq("activo", true).maybeSingle();
    // El "usuario" (login) es el correo corporativo de cada persona -- no
    // existe un campo de correo separado. Respuesta siempre generica (no
    // revela si el usuario existe) -- el envio real ocurre "en silencio".
    if (user) {
      try {
        const tokenPayload = {
          purpose: "reset", id: user.id, pwv: pwVersion(user.password_hash),
          exp: Math.floor(Date.now() / 1000) + 30 * 60,
        };
        const token = signToken(tokenPayload, SESSION_SECRET);
        const base = process.env.APP_URL || "https://ocsys.vercel.app";
        const resetUrl = base + "/?reset=" + token;
        await enviarCorreoResetPassword(user, resetUrl);
      } catch (e) {
        // No se expone el detalle al cliente para no filtrar si el correo
        // falló por credenciales, por el usuario no tener correo, etc.
      }
    }
    return res.status(200).json(respuesta);
  }

  if (action === "reset-password") {
    const body = await readJsonBody(req);
    const token = body.token || "";
    const password = body.password || "";
    if (!token) return res.status(400).json({ error: "Enlace inválido" });
    if (!password || password.length < 6) {
      return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
    }
    const payload = verifyToken(token, SESSION_SECRET);
    if (!payload || payload.purpose !== "reset") {
      return res.status(400).json({ error: "El enlace no es válido o expiró. Solicita uno nuevo." });
    }
    const db = supabase();
    const { data: user } = await db.from("usuarios").select("*").eq("id", payload.id).eq("activo", true).maybeSingle();
    if (!user || pwVersion(user.password_hash) !== payload.pwv) {
      return res.status(400).json({ error: "El enlace ya fue usado o no es válido. Solicita uno nuevo." });
    }
    const { error } = await db
      .from("usuarios")
      .update({ password_hash: hashPassword(password), updated_at: new Date().toISOString() })
      .eq("id", user.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (action === "logout") {
    res.setHeader("Set-Cookie", clearCookie());
    return res.status(200).json({ ok: true });
  }

  if (action === "me") {
    const token = parseCookie(req.headers.cookie, "ocsys_token");
    const payload = verifyToken(token, SESSION_SECRET);
    if (!payload) return res.status(401).json({ error: "No autenticado" });

    // Ventana deslizante: cada chequeo de actividad renueva la sesión (tope: medianoche)
    const exp = computeExpiry();
    const refreshed = { ...payload, exp };
    const newToken = signToken(refreshed, SESSION_SECRET);
    res.setHeader("Set-Cookie", makeCookie(newToken, exp - Math.floor(Date.now() / 1000)));
    return res.status(200).json(refreshed);
  }

  return res.status(400).json({ error: "Acción desconocida: " + action });
}
