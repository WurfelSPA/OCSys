import { supabase, readJsonBody } from "./_supabase.js";
import { verifyToken, parseCookie } from "./_session.js";

export default async function handler(req, res) {
  const db = supabase();

  if (req.method === "GET") {
    const { data, error } = await db.from("empresas").select("*").order("id");
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ empresas: data });
  }

  if (req.method === "PUT") {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "id es obligatorio" });

    const session = verifyToken(parseCookie(req.headers.cookie, "ocsys_token"), process.env.SESSION_SECRET || "");
    if (!session || session.nivel_aprobacion !== 1) {
      return res.status(403).json({ error: "No tienes nivel de aprobación para modificar la configuración de la empresa" });
    }

    const body = await readJsonBody(req);
    const fields = {};
    if (body.correo_contabilidad !== undefined) fields.correo_contabilidad = body.correo_contabilidad;

    if (Object.keys(fields).length === 0) {
      return res.status(400).json({ error: "No hay campos para actualizar" });
    }

    const { data, error } = await db.from("empresas").update(fields).eq("id", id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ empresa: data });
  }

  res.setHeader("Allow", "GET, PUT");
  return res.status(405).json({ error: "Método no permitido" });
}
