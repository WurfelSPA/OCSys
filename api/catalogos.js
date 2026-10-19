import { supabase } from "./_supabase.js";

// Lista de "a que cliente/ubicacion va dirigida esta OC" para el desplegable
// Cliente de Nueva OC -- independiente del catalogo de Centro de Costo/Cuenta
// Contable/Proyecto. Reusa el mismo catastro de sitio/edificio/unidad +
// contrato vigente cargado para OT Mantencion (ver Planilla de Facturacion),
// una fila por unidad con su cliente vigente hoy (o "VACANTE" si no tiene).
async function construirClientesOc(db, empresaId) {
  const hoy = new Date().toISOString().slice(0, 10);
  const { data, error } = await db
    .from("unidad")
    .select("id, codigo, edificio!inner(nombre, sitio!inner(codigo, empresa_id)), contrato_unidad(desde, hasta, contrato_operaciones(cliente_operaciones(id, rut, razon_social)))")
    .eq("edificio.sitio.empresa_id", empresaId)
    .order("codigo");
  if (error) return { data: null, error };

  // detalle agrupa por etiqueta las unidades/clientes que la producen -- la
  // etiqueta es a nivel edificio (no unidad especifica), asi que un mismo
  // texto puede salir de varias unidades con igual cliente vigente (ver
  // "Generar OT" en Nueva OC: solo se autocompleta Ubicacion/Cliente cuando
  // hay una sola unidad detras de la etiqueta elegida -- si hay mas de una
  // no se adivina cual, se deja elegir a mano).
  const detalle = {};
  const etiquetas = (data || []).map((u) => {
    const vigente = (u.contrato_unidad || []).find((cu) => cu.desde <= hoy && (!cu.hasta || cu.hasta >= hoy));
    const cliente = vigente?.contrato_operaciones?.cliente_operaciones;
    const sitioCod = u.edificio?.sitio?.codigo || "";
    const edifNom = u.edificio?.nombre || u.codigo;
    const etiqueta = cliente
      ? [sitioCod, edifNom, cliente.rut, cliente.razon_social].filter(Boolean).join(" — ")
      : [sitioCod, edifNom, "VACANTE"].filter(Boolean).join(" — ");
    (detalle[etiqueta] = detalle[etiqueta] || []).push({ unidad_id: u.id, cliente_id: cliente ? cliente.id : null });
    return etiqueta;
  });
  // Mismo sitio/edificio puede repetirse si tiene mas de una unidad con el
  // mismo cliente -- sin duplicados en el desplegable.
  return { data: [...new Set(etiquetas)].sort(), detalle, error: null };
}

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

  const [centrosCosto, cuentasContables, regiones, ciudades, clientesOc] = await Promise.all([
    centrosCostoQuery,
    cuentasContablesQuery,
    db.from("regiones").select("id, nombre").order("nombre"),
    db.from("ciudades").select("id, region_id, nombre").order("nombre"),
    construirClientesOc(db, empresaId),
  ]);

  const err = centrosCosto.error || cuentasContables.error || regiones.error || ciudades.error || clientesOc.error;
  if (err) return res.status(500).json({ error: err.message });

  return res.status(200).json({
    centrosCosto: centrosCosto.data,
    cuentasContables: cuentasContables.data,
    regiones: regiones.data,
    ciudades: ciudades.data,
    clientesOc: clientesOc.data,
    clientesOcDetalle: clientesOc.detalle,
  });
}
