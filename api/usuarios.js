import { supabase, readJsonBody } from "./_supabase.js";
import { hashPassword, verifyPassword } from "./_auth.js";

function toPublic(u) {
  const { password_hash, ...rest } = u;
  return { ...rest, tiene_password: !!password_hash };
}

export default async function handler(req, res) {
  const db = supabase();

  if (req.method === "POST" && req.query.action === "verificar") {
    const { id, password } = await readJsonBody(req);
    if (!id || !password) return res.status(400).json({ error: "id y password son obligatorios" });
    const { data: usuario, error } = await db.from("usuarios").select("password_hash").eq("id", id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!usuario || !verifyPassword(password, usuario.password_hash)) {
      return res.status(401).json({ error: "Contraseña incorrecta" });
    }
    return res.status(200).json({ ok: true });
  }

  if (req.method === "GET") {
    const { data, error } = await db
      .from("usuarios")
      .select("*")
      .order("nombre", { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ usuarios: data.map(toPublic) });
  }

  if (req.method === "POST" || req.method === "PUT") {
    const body = await readJsonBody(req);
    if (!body.nombre || !body.apellido || !body.usuario) {
      return res.status(400).json({ error: "nombre, apellido y usuario son obligatorios" });
    }
    const nivel = Number(body.nivel_aprobacion);
    if (nivel !== 0 && nivel !== 1) {
      return res.status(400).json({ error: "nivel_aprobacion debe ser 0 o 1" });
    }

    const fields = {
      nombre: body.nombre,
      apellido: body.apellido,
      usuario: body.usuario,
      nivel_aprobacion: nivel,
    };
    if (body.password) fields.password_hash = hashPassword(body.password);

    if (req.method === "PUT") {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "id es obligatorio" });
      const { data, error } = await db
        .from("usuarios")
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) {
        if (error.code === "23505") return res.status(409).json({ error: "Ya existe un usuario con ese nombre de usuario" });
        return res.status(500).json({ error: error.message });
      }
      return res.status(200).json({ usuario: toPublic(data) });
    }

    const { data, error } = await db.from("usuarios").insert(fields).select().single();
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: "Ya existe un usuario con ese nombre de usuario" });
      return res.status(500).json({ error: error.message });
    }
    return res.status(201).json({ usuario: toPublic(data) });
  }

  res.setHeader("Allow", "GET, POST, PUT");
  return res.status(405).json({ error: "Método no permitido" });
}
