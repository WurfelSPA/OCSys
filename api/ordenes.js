import { supabase, readJsonBody } from "./_supabase.js";

export default async function handler(req, res) {
  const db = supabase();

  if (req.method === "GET") {
    const { data, error } = await db
      .from("ordenes_compra")
      .select("*, proveedores(razon_social, rut)")
      .order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ordenes: data });
  }

  if (req.method === "POST") {
    const body = await readJsonBody(req);
    if (!body.proveedor_id) {
      return res.status(400).json({ error: "proveedor_id es obligatorio" });
    }
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
        numero_hes: body.numero_hes || null,
        numero_egreso: body.numero_egreso || null,
        numero_factura: body.numero_factura || null,
        archivo_url: body.archivo_url || null,
        archivo_nombre: body.archivo_nombre || null,
        creado_por: body.creado_por || null,
      })
      .select("*, proveedores(razon_social, rut)")
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ orden: data });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Método no permitido" });
}
