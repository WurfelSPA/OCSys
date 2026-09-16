import { supabase, readJsonBody } from "./_supabase.js";
import { verifyToken, parseCookie } from "./_session.js";

export default async function handler(req, res) {
  const db = supabase();

  if (req.method === "GET") {
    const empresaId = Number(req.query.empresa_id) || 1;
    const { data, error } = await db
      .from("rendiciones_gastos")
      .select("*")
      .eq("activo", true)
      .eq("empresa_id", empresaId)
      .order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ rendiciones: data });
  }

  if (req.method === "POST") {
    const body = await readJsonBody(req);
    if (!body.fecha_gasto || !body.nombre_apellido || !body.monto) {
      return res.status(400).json({ error: "fecha_gasto, nombre_apellido y monto son obligatorios" });
    }
    const { data, error } = await db
      .from("rendiciones_gastos")
      .insert({
        fecha_gasto: body.fecha_gasto,
        nombre_apellido: body.nombre_apellido,
        descripcion: body.descripcion || null,
        monto: body.monto,
        cuenta_contable_codigo: body.cuenta_contable_codigo || null,
        empresa_id: Number(body.empresa_id) || 1,
        estado: "Proceso de Pago",
        archivo_boleta_url: body.archivo_boleta_url || null,
        archivo_boleta_nombre: body.archivo_boleta_nombre || null,
      })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ rendicion: data });
  }

  if (req.method === "PUT") {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "id es obligatorio" });
    const body = await readJsonBody(req);

    const fields = {};
    if (body.archivo_comprobante_url !== undefined) {
      fields.archivo_comprobante_url = body.archivo_comprobante_url;
      fields.archivo_comprobante_nombre = body.archivo_comprobante_nombre || null;
      // Subir el comprobante de pago es justamente la accion que marca el
      // reembolso como pagado -- no hace falta un paso de estado separado.
      fields.estado = "Pagado";
    }
    if (Object.keys(fields).length === 0) {
      return res.status(400).json({ error: "No hay campos para actualizar" });
    }

    const { data, error } = await db
      .from("rendiciones_gastos")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ rendicion: data });
  }

  if (req.method === "DELETE") {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "id es obligatorio" });
    const session = verifyToken(parseCookie(req.headers.cookie, "ocsys_token"), process.env.SESSION_SECRET || "");
    if (!session) return res.status(401).json({ error: "No autenticado" });
    if (session.nivel_aprobacion !== 1) {
      return res.status(403).json({ error: "No tienes nivel de aprobación para eliminar rendiciones" });
    }
    const { error } = await db
      .from("rendiciones_gastos")
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
