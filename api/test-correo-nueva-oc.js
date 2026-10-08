// Endpoint temporal de un solo uso para verificar si enviarCorreoNuevaOC
// realmente logra enviar para una OC real puntual (?numero=00337), sin
// depender de logs de Vercel a los que no tenemos acceso. Se borra apenas
// se confirma el resultado.
import { supabase } from "./_supabase.js";
import { enviarCorreoNuevaOC } from "./_email.js";

export default async function handler(req, res) {
  const numero = req.query.numero || "00336";
  const db = supabase();
  const { data, error } = await db
    .from("ordenes_compra")
    .select("*, proveedores(razon_social, rut, contacto_correo, banco, tipo_cuenta, numero_cuenta), proyectos(nombre)")
    .ilike("numero_oc", "%" + numero + "%")
    .order("cuota_numero", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  if (!data || !data.length) return res.status(404).json({ error: "OC " + numero + " no encontrada" });

  try {
    await enviarCorreoNuevaOC(data, null, "amelendez@patagonica.cl");
    return res.status(200).json({ ok: true, enviado_a: "amelendez@patagonica.cl", filas: data.length });
  } catch (e) {
    return res.status(500).json({ error: e.message, stack: e.stack });
  }
}
