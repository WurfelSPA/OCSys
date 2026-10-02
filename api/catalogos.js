import { supabase } from "./_supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método no permitido" });
  }

  const db = supabase();
  const empresaId = Number(req.query.empresa_id) || 1;
  const todas = !!req.query.all;

  let centrosCostoQuery = db.from("centros_costo").select("codigo, descripcion, empresa_id").eq("activo", true).order("codigo");
  let cuentasContablesQuery = db.from("cuentas_contables").select("codigo, descripcion, centro_costo_codigo, empresa_id").eq("activo", true).order("descripcion");
  if (!todas) {
    centrosCostoQuery = centrosCostoQuery.eq("empresa_id", empresaId);
    cuentasContablesQuery = cuentasContablesQuery.eq("empresa_id", empresaId);
  }

  const [centrosCosto, cuentasContables, regiones, ciudades] = await Promise.all([
    centrosCostoQuery,
    cuentasContablesQuery,
    db.from("regiones").select("id, nombre").order("nombre"),
    db.from("ciudades").select("id, region_id, nombre").order("nombre"),
  ]);

  const err = centrosCosto.error || cuentasContables.error || regiones.error || ciudades.error;
  if (err) return res.status(500).json({ error: err.message });

  return res.status(200).json({
    centrosCosto: centrosCosto.data,
    cuentasContables: cuentasContables.data,
    regiones: regiones.data,
    ciudades: ciudades.data,
  });
}
