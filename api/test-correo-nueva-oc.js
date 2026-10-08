// Endpoint temporal de un solo uso para reenviar el correo de prueba de
// "Nueva OC para aprobar" (PA-OC-00336) a amelendez@patagonica.cl. Se borra
// apenas se confirma que llegó.
import { supabase } from "./_supabase.js";
import { enviarCorreoNuevaOC } from "./_email.js";

export default async function handler(req, res) {
  const db = supabase();
  const { data, error } = await db
    .from("ordenes_compra")
    .select("*, proveedores(razon_social, rut, contacto_correo, banco, tipo_cuenta, numero_cuenta), proyectos(nombre)")
    .ilike("numero_oc", "%00336%")
    .order("cuota_numero", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  if (!data || !data.length) return res.status(404).json({ error: "PA-OC-00336 no encontrada" });

  try {
    await enviarCorreoNuevaOC(data, null, "amelendez@patagonica.cl");
    return res.status(200).json({ ok: true, enviado_a: "amelendez@patagonica.cl", filas: data.length });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
