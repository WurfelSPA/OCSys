import { supabase, readJsonBody } from "./_supabase.js";
import { verifyToken, parseCookie } from "./_session.js";
import { enviarCorreoAprobacion, enviarCorreoFactura } from "./_email.js";

// Aprobada -> se asigna HES y se envia la OC al proveedor.
// Facturada -> se subio la factura del proveedor; se avisa al equipo de pagos.
// Completada -> se subio el comprobante de pago, cierra el ciclo.
const ESTADOS_OCSYS = ["Borrador", "Pendiente aprobación", "Aprobada", "Facturada", "Completada"];

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
        // El cliente puede generar y enviar su propio numero_hes junto con
        // el PDF ya regenerado con ese mismo HES (para que el correo de
        // aprobacion salga con el PDF correcto desde el primer envio, sin
        // un segundo paso). Si no lo manda, se genera aqui como antes.
        fields.numero_hes = body.numero_hes || Date.now().toString();
      }
      if (body.estado === "Facturada" && !body.numero_factura) {
        return res.status(400).json({ error: "numero_factura es obligatorio para facturar la OC" });
      }
      if (body.estado === "Completada" && !body.archivo_comprobante_url) {
        return res.status(400).json({ error: "El comprobante de pago es obligatorio para completar la OC" });
      }
      fields.estado = body.estado;
    }
    if (body.numero_factura !== undefined) fields.numero_factura = body.numero_factura;
    if (body.monto_facturado !== undefined) fields.monto_facturado = body.monto_facturado;
    if (body.archivo_factura_url !== undefined) fields.archivo_factura_url = body.archivo_factura_url;
    if (body.archivo_factura_nombre !== undefined) fields.archivo_factura_nombre = body.archivo_factura_nombre;
    if (body.archivo_oc_url !== undefined) fields.archivo_oc_url = body.archivo_oc_url;
    if (body.archivo_oc_nombre !== undefined) fields.archivo_oc_nombre = body.archivo_oc_nombre;
    if (body.archivo_url !== undefined) fields.archivo_url = body.archivo_url;
    if (body.archivo_nombre !== undefined) fields.archivo_nombre = body.archivo_nombre;
    if (body.archivo_comprobante_url !== undefined) fields.archivo_comprobante_url = body.archivo_comprobante_url;
    if (body.archivo_comprobante_nombre !== undefined) fields.archivo_comprobante_nombre = body.archivo_comprobante_nombre;
    // Correccion manual de historicos migrados (no genera HES nuevo, a diferencia
    // de la transicion a "Aprobada" mas arriba, que sí lo asigna automaticamente).
    if (body.numero_hes !== undefined && body.estado === undefined) fields.numero_hes = body.numero_hes;
    if (body.numero_oc !== undefined) fields.numero_oc = body.numero_oc;
    if (body.titulo !== undefined) fields.titulo = body.titulo;
    if (body.descripcion !== undefined) fields.descripcion = body.descripcion;
    if (body.motivo !== undefined) fields.motivo = body.motivo;
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
        await enviarCorreoAprobacion(data);
      } catch (e) {
        correoError = e.message;
      }
    }
    if (body.estado === "Facturada") {
      try {
        await enviarCorreoFactura(data);
      } catch (e) {
        correoError = e.message;
      }
    }
    return res.status(200).json({ orden: data, correoError });
  }

  if (req.method === "GET") {
    const empresaId = Number(req.query.empresa_id) || 1;
    const { data, error } = await db
      .from("ordenes_compra")
      .select("*, proveedores(razon_social, rut)")
      .eq("activo", true)
      .eq("empresa_id", empresaId)
      .order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ordenes: data });
  }

  if (req.method === "DELETE") {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "id es obligatorio" });
    const session = verifyToken(parseCookie(req.headers.cookie, "ocsys_token"), process.env.SESSION_SECRET || "");
    if (!session) return res.status(401).json({ error: "No autenticado" });
    if (session.nivel_aprobacion !== 1) {
      return res.status(403).json({ error: "No tienes nivel de aprobación para eliminar órdenes de compra" });
    }
    const { error } = await db
      .from("ordenes_compra")
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

  if (req.method === "POST") {
    const body = await readJsonBody(req);
    if (!body.proveedor_id) {
      return res.status(400).json({ error: "proveedor_id es obligatorio" });
    }
    const empresaId = Number(body.empresa_id) || 1;
    const estado = ESTADOS_OCSYS.includes(body.estado) ? body.estado : "Borrador";

    const { data: empresa, error: empresaError } = await db.from("empresas").select("codigo").eq("id", empresaId).maybeSingle();
    if (empresaError) return res.status(500).json({ error: empresaError.message });
    const { data: siguiente, error: seqError } = await db.rpc("siguiente_numero_oc", { p_empresa_id: empresaId });
    if (seqError) return res.status(500).json({ error: seqError.message });
    const fechaHoy = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const numero_oc = (empresa?.codigo || "OC") + "-OC-" + fechaHoy + "-" + String(siguiente).padStart(5, "0");

    const { data, error } = await db
      .from("ordenes_compra")
      .insert({
        numero_oc,
        proveedor_id: body.proveedor_id,
        empresa_id: empresaId,
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
