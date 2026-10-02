import { supabase, readJsonBody } from "./_supabase.js";
import { verifyToken, parseCookie } from "./_session.js";

// Bitacora de proyectos/trabajos en curso (independiente del catalogo
// "proyectos" que se usa como campo en Nueva OC) -- reemplaza el grupo de
// WhatsApp donde se informaban avances, para dejar un historial ordenado
// con fecha y autor de cada nota, pensando en poder sacar un informe de
// gestion mas adelante. Crear/editar/comentar/marcar estado/eliminar es
// libre para cualquier usuario con sesion, sin restriccion de nivel -- pero
// es una herramienta interna, solo personal con correo @patagonica.cl.
export default async function handler(req, res) {
  const db = supabase();
  const session = verifyToken(parseCookie(req.headers.cookie, "ocsys_token"), process.env.SESSION_SECRET || "");

  if (!session || !(session.usuario || "").toLowerCase().endsWith("@patagonica.cl")) {
    return res.status(403).json({ error: "Esta función es solo para personal de Patagónica" });
  }

  if (req.method === "GET") {
    const empresaId = Number(req.query.empresa_id) || 1;
    const { data, error } = await db
      .from("seguimiento_proyectos")
      .select("*, seguimiento_proyectos_comentarios(*)")
      .eq("empresa_id", empresaId)
      .eq("activo", true)
      .order("created_at", { ascending: false })
      .order("created_at", { ascending: true, foreignTable: "seguimiento_proyectos_comentarios" });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ proyectos: data });
  }

  if (req.method === "POST") {
    if (req.query.comentario === "1") {
      const body = await readJsonBody(req);
      const texto = (body.texto || "").trim();
      if (!texto) return res.status(400).json({ error: "texto es obligatorio" });
      if (!body.proyecto_id) return res.status(400).json({ error: "proyecto_id es obligatorio" });
      const { data, error } = await db
        .from("seguimiento_proyectos_comentarios")
        .insert({ proyecto_id: body.proyecto_id, texto, usuario: session.usuario })
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json({ comentario: data });
    }

    const body = await readJsonBody(req);
    const descripcion = (body.descripcion || "").trim();
    if (!descripcion) return res.status(400).json({ error: "descripcion es obligatoria" });
    if (!body.fecha_inicio) return res.status(400).json({ error: "fecha_inicio es obligatoria" });
    const empresaId = Number(body.empresa_id);
    if (!empresaId) return res.status(400).json({ error: "empresa_id es obligatorio" });
    const { data, error } = await db
      .from("seguimiento_proyectos")
      .insert({
        empresa_id: empresaId,
        descripcion,
        fecha_inicio: body.fecha_inicio,
        creado_por_usuario: session.usuario,
      })
      .select("*, seguimiento_proyectos_comentarios(*)")
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ proyecto: data });
  }

  if (req.method === "PUT") {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "id es obligatorio" });
    const body = await readJsonBody(req);
    const fields = {};
    if (body.descripcion !== undefined) fields.descripcion = body.descripcion;
    if (body.fecha_inicio !== undefined) fields.fecha_inicio = body.fecha_inicio;
    if (body.finalizado !== undefined) fields.finalizado = body.finalizado;
    if (body.fecha_culminacion !== undefined) {
      fields.fecha_culminacion = body.fecha_culminacion;
    } else if (body.finalizado === true) {
      // Se autocompleta con hoy solo si todavia no tenia una fecha de
      // culminacion cargada -- si ya tenia una (puesta a mano antes), se
      // respeta y no se pisa.
      const { data: actual } = await db.from("seguimiento_proyectos").select("fecha_culminacion").eq("id", id).maybeSingle();
      if (!actual?.fecha_culminacion) {
        fields.fecha_culminacion = new Date().toISOString().slice(0, 10);
      }
    }
    if (Object.keys(fields).length === 0) {
      return res.status(400).json({ error: "No hay campos para actualizar" });
    }
    const { data, error } = await db
      .from("seguimiento_proyectos")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*, seguimiento_proyectos_comentarios(*)")
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ proyecto: data });
  }

  if (req.method === "DELETE") {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "id es obligatorio" });
    const { error } = await db
      .from("seguimiento_proyectos")
      .update({
        activo: false,
        eliminado_por: session.usuario,
        eliminado_en: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", "GET, POST, PUT, DELETE");
  return res.status(405).json({ error: "Método no permitido" });
}
