import { supabase, readJsonBody } from "./_supabase.js";
import { verifyToken, parseCookie } from "./_session.js";
import { enviarCorreoAprobacion } from "./_email.js";

const ESTADOS_OCSYS = ["Borrador", "Pendiente aprobación", "Aprobada", "Completada"];

export default async function handler(req, res) {
  const db = supabase();

  if (req.method === "PUT") {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "id es obligatorio" });
    const body = await readJsonBody(req);

    const fields = {};
    let session = null;
    if (body.estado !== undefined) {
      if (!ESTADOS_OCSYS.includes(body.estado)) {
        return res.status(400).json({ error: "estado inválido" });
      }
      if (body.estado === "Aprobada") {
        session = verifyToken(parseCookie(req.headers.cookie, "ocsys_token"), process.env.SESSION_SECRET || "");
        if (!session || session.nivel_aprobacion !== 1) {
          return res.status(403).json({ error: "No tienes nivel de aprobación para aprobar órdenes de compra" });
        }
        fields.numero_hes = Date.now().toString();
      }
      if (body.estado === "Completada" && !body.numero_factura) {
        return res.status(400).json({ error: "numero_factura es obligatorio para completar la OC" });
      }
      fields.estado = body.estado;
    }
    if (body.numero_factura !== undefined) fields.numero_factura = body.numero_factura;
    if (body.archivo_factura_url !== undefined) fields.archivo_factura_url = body.archivo_factura_url;
    if (body.archivo_factura_nombre !== undefined) fields.archivo_factura_nombre = body.archivo_factura_nombre;
    if (body.archivo_oc_url !== undefined) fields.archivo_oc_url = body.archivo_oc_url;
    if (body.archivo_oc_nombre !== undefined) fields.archivo_oc_nombre = body.archivo_oc_nombre;
    if (body.cuotas !== undefined) fields.cuotas = Array.isArray(body.cuotas) ? body.cuotas : [];

    if (Object.keys(fields).length === 0) {
      return res.status(400).json({ error: "No hay campos para actualizar" });
    }

    const { data, error } = await db
      .from("ordenes_compra")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*, proveedores(razon_social, rut, contacto_correo)")
      .single();
    if (error) return res.status(500).json({ error: error.message });

    let correoError = null;
    if (body.estado === "Aprobada") {
      try {
        await enviarCorreoAprobacion(data, session);
      } catch (e) {
        correoError = e.message;
      }
    }
    return res.status(200).json({ orden: data, correoError });
  }

  if (req.method === "GET") {
    const { data, error } = await db
      .from("ordenes_compra")
      .select("*, proveedores(razon_social, rut)")
      .order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ordenes: data });
  }

  if (req.method === "DELETE") {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "id es obligatorio" });
    const session = verifyToken(parseCookie(req.headers.cookie, "ocsys_token"), process.env.SESSION_SECRET || "");
    if (!session) return res.status(401).json({ error: "No autenticado" });
    const { error } = await db.from("ordenes_compra").delete().eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (req.method === "POST") {
    const body = await readJsonBody(req);
    if (!body.proveedor_id) {
      return res.status(400).json({ error: "proveedor_id es obligatorio" });
    }
    const estado = ESTADOS_OCSYS.includes(body.estado) ? body.estado : "Borrador";
    const { data, error } = await db
      .from("ordenes_compra")
      .insert({
        proveedor_id: body.proveedor_id,
        fecha: body.fecha || undefined,
        titulo: body.titulo || null,
        descripcion: body.descripcion || null,
        motivo: body.motivo || null,
        gerencia: body.gerencia || null,
        centro_costo_codigo: body.centro_costo_codigo || null,
        cuenta_contable_codigo: body.cuenta_contable_codigo || null,
        tipo_orden: body.tipo_orden || null,
        tipo_compra: body.tipo_compra || null,
        moneda: body.moneda || "CLP",
        monto_neto: body.monto_neto || null,
        monto_iva: body.monto_iva || null,
        monto_total: body.monto_total || null,
        estado,
        archivo_url: body.archivo_url || null,
        archivo_nombre: body.archivo_nombre || null,
        creado_por: body.creado_por || null,
        cuotas: Array.isArray(body.cuotas) ? body.cuotas : [],
      })
      .select("*, proveedores(razon_social, rut)")
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ orden: data });
  }

  res.setHeader("Allow", "GET, POST, PUT, DELETE");
  return res.status(405).json({ error: "Método no permitido" });
}
