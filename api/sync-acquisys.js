import { supabase, readJsonBody } from "./_supabase.js";
import { verifyToken, parseCookie } from "./_session.js";

// Sincroniza ordenes desde el endpoint /admin/order de Acquisys (el cliente
// ya trae la lista completa con el user_token del portal). Para cada orden:
// - Si ya existe en OCSys (por numero_oc = N de Memorandum), completa los
//   campos que falten (numero_hes, numero_factura, cuotas, cotizacion) sin
//   pisar lo que ya esta cargado.
// - Si no existe, la crea completa (proveedor existente o nuevo, centro de
//   costo/cuenta contable validados contra catalogos, montos, cuotas, HES,
//   factura) y adjunta la cotizacion.
// El PDF de la OC (archivo_oc_url) no se genera aqui -- requiere jsPDF en el
// navegador, lo hace un segundo paso en el cliente tras llamar esta funcion.

function rutNorm(r) {
  return (r || "").replace(/[^0-9kK]/g, "").toUpperCase();
}

function memoDeUrl(url) {
  const filename = (url || "").split("/").pop();
  // El patron real es "<memorandum>-<timestamp>.<ext>" — la extension puede
  // ser cualquier cosa (pdf, xlsx, rar, etc.), asi que se quita de forma
  // generica en vez de listar extensiones conocidas (una desconocida dejaba
  // el sufijo pegado y rompia el match contra numero_oc).
  return filename.replace(/-\d+\.\w+$/i, "");
}

const CAMPOS_PARA_FICHA_COMPLETA = [
  "giro_comercial", "direccion_comercial", "region", "ciudad",
  "contacto_correo", "banco", "tipo_cuenta", "numero_cuenta",
];
function calcularDatosCompletos(fields) {
  const tieneContactoTelefonico = !!(fields.telefono || fields.contacto_telefono || fields.contacto_celular);
  return tieneContactoTelefonico && CAMPOS_PARA_FICHA_COMPLETA.every((k) => !!fields[k]);
}

async function adjuntarCotizacion(db, ordenId, cotizacionUrl, userToken) {
  const filename = (cotizacionUrl || "").split("/").pop();
  const r = await fetch(cotizacionUrl, { headers: { user_token: userToken } });
  if (!r.ok) throw new Error("descarga cotización falló: " + r.status);
  const contentType = r.headers.get("content-type") || "application/octet-stream";
  const buf = Buffer.from(await r.arrayBuffer());
  const path = "acquisys-historico/" + filename;
  const { error: upErr } = await db.storage.from("ocsys-archivos").upload(path, buf, { contentType, upsert: true });
  if (upErr) throw new Error("upload storage: " + upErr.message);
  const { data: pub } = db.storage.from("ocsys-archivos").getPublicUrl(path);
  await db.from("ordenes_compra").update({ archivo_url: pub.publicUrl, archivo_nombre: filename }).eq("id", ordenId);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método no permitido" });
  }

  const session = verifyToken(parseCookie(req.headers.cookie, "ocsys_token"), process.env.SESSION_SECRET || "");
  if (!session || session.nivel_aprobacion !== 1) {
    return res.status(403).json({ error: "No tienes nivel de aprobación para sincronizar con Acquisys" });
  }

  const { userToken, ordenes, empresaId: empresaIdRaw } = await readJsonBody(req);
  const empresaId = Number(empresaIdRaw) || 1;
  if (!userToken || !Array.isArray(ordenes) || !ordenes.length) {
    return res.status(400).json({ error: "userToken y ordenes (array) son obligatorios" });
  }

  const db = supabase();

  const [{ data: proveedoresExistentes }, { data: centrosCosto }, { data: cuentasContables }, { data: empresa }] = await Promise.all([
    db.from("proveedores").select("id, rut").eq("activo", true),
    db.from("centros_costo").select("codigo").eq("activo", true).eq("empresa_id", empresaId),
    db.from("cuentas_contables").select("codigo").eq("activo", true).eq("empresa_id", empresaId),
    db.from("empresas").select("codigo").eq("id", empresaId).maybeSingle(),
  ]);
  const empresaCodigo = empresa?.codigo || "EMP";
  const proveedorPorRut = new Map((proveedoresExistentes || []).map((p) => [rutNorm(p.rut), p.id]));
  const centrosCostoValidos = new Set((centrosCosto || []).map((c) => c.codigo));
  const cuentasContablesValidas = new Set((cuentasContables || []).map((c) => c.codigo));

  async function resolverProveedor(o) {
    const rut = o.rut_prov;
    if (!rut) return null;
    const existenteId = proveedorPorRut.get(rutNorm(rut));
    if (existenteId) return existenteId;

    const banco = (o.bank_info || [])[0] || {};
    const fields = {
      razon_social: o.razon_social || rut,
      tipo_documento: o.facture === "1" ? "Factura Exenta" : "Factura Afecta",
      rut,
      giro_comercial: o.giro || null,
      contacto_correo: o.email || null,
      banco: banco.bank || null,
      tipo_cuenta: banco.account_type || null,
      numero_cuenta: banco.account_number || null,
    };
    fields.datos_completos = calcularDatosCompletos(fields);
    const { data: creado, error } = await db.from("proveedores").insert(fields).select("id").single();
    if (error) {
      if (error.code === "23505") {
        const { data: retry } = await db.from("proveedores").select("id").eq("rut", rut).maybeSingle();
        if (retry) { proveedorPorRut.set(rutNorm(rut), retry.id); return retry.id; }
      }
      throw new Error("proveedor: " + error.message);
    }
    proveedorPorRut.set(rutNorm(rut), creado.id);
    return creado.id;
  }

  async function procesarOrden(o) {
    const memo = memoDeUrl(o.cotizacion);
    if (!memo) throw new Error("sin memorandum derivable de cotizacion");

    const tipoOrden = o.facture === "1" ? "Exento" : "Afecto";
    const neto = Number(o.amount_neto) || 0;
    const total = tipoOrden === "Afecto" ? Math.round(neto * 1.19 * 100) / 100 : neto;
    const cc = (o.centro_costo || [])[0];
    const cu = (o.cuenta_contable || [])[0];
    const ccCodigo = cc && centrosCostoValidos.has(cc.code) ? cc.code : null;
    const cuCodigo = cu && cuentasContablesValidas.has(cu.code) ? cu.code : null;
    const hes = (o.order_detail || []).map((d) => d.ges).filter(Boolean).join(", ") || null;
    const factura = (o.facturas_validas || []).map((f) => f.num_facture).filter(Boolean).join(", ") || null;
    const montoFacturadoSum = (o.facturas_validas || []).reduce((s, f) => s + (Number(f.net_mount) || 0), 0);
    const montoFacturado = montoFacturadoSum > 0 ? montoFacturadoSum : null;
    const cuotas = (o.order_detail || []).map((d) => ({
      dias: d.days || 0, observacion: d.observation || "", monto: d.amount || 0, porcentaje: d.percent || 0,
    }));

    const { data: existente } = await db.from("ordenes_compra").select("*").eq("numero_oc", memo).eq("empresa_id", empresaId).maybeSingle();

    if (existente) {
      const campos = {};
      if (!existente.numero_hes && hes) campos.numero_hes = hes;
      if (!existente.numero_factura && factura) campos.numero_factura = factura;
      if (existente.monto_facturado == null && montoFacturado != null) campos.monto_facturado = montoFacturado;
      if ((!existente.cuotas || existente.cuotas.length === 0) && cuotas.length) campos.cuotas = cuotas;
      // La migracion historica original guardo mal la fecha en muchos casos
      // (quedo con la fecha en que se corrio la migracion, no la real del
      // gasto) -- se corrige contra la fecha real de Acquisys si difiere.
      if (o.date_oc && existente.fecha !== o.date_oc) campos.fecha = o.date_oc;
      // Mismo problema con la moneda: 43 ordenes quedaron como CLP aunque en
      // Acquisys estaban en UF (el monto ya era el correcto, solo la
      // etiqueta de moneda estaba mal) -- se corrige contra type_money.
      if (o.type_money && existente.moneda !== o.type_money) campos.moneda = o.type_money;
      if (Object.keys(campos).length) {
        await db.from("ordenes_compra").update(campos).eq("id", existente.id);
      }
      let cotizacionAdjuntada = false;
      if (!existente.archivo_url && o.cotizacion) {
        await adjuntarCotizacion(db, existente.id, o.cotizacion, userToken);
        cotizacionAdjuntada = true;
      }
      return { numero_oc: memo, accion: "actualizada", campos: Object.keys(campos), cotizacionAdjuntada };
    }

    const proveedorId = await resolverProveedor(o);
    const camposOrden = {
      empresa_id: empresaId,
      proveedor_id: proveedorId,
      fecha: o.date_oc || undefined,
      gerencia: o.gerencia || null,
      centro_costo_codigo: ccCodigo,
      cuenta_contable_codigo: cuCodigo,
      tipo_orden: tipoOrden,
      moneda: o.type_money || "CLP",
      monto_neto: neto,
      monto_total: total,
      estado: o.status || "Activo",
      creado_por: o.responsible || null,
      numero_hes: hes,
      numero_factura: factura,
      monto_facturado: montoFacturado,
      cuotas,
    };

    let numeroOcFinal = memo;
    let { data: creada, error } = await db.from("ordenes_compra").insert({ numero_oc: numeroOcFinal, ...camposOrden }).select("id").single();
    if (error && error.code === "23505") {
      // El N de Memorandum ya existe para otra empresa (cada entidad en
      // Acquisys numera de forma independiente) -- se antepone el codigo de
      // esta empresa solo para el caso real de choque, sin renombrar nada
      // que ya estuviera cargado.
      numeroOcFinal = empresaCodigo + "-" + memo;
      ({ data: creada, error } = await db.from("ordenes_compra").insert({ numero_oc: numeroOcFinal, ...camposOrden }).select("id").single());
    }
    if (error) throw new Error("orden: " + error.message);

    if (o.cotizacion) await adjuntarCotizacion(db, creada.id, o.cotizacion, userToken);

    return { numero_oc: numeroOcFinal, accion: "creada" };
  }

  const vistos = new Set();
  const unicas = ordenes.filter((o) => {
    const memo = memoDeUrl(o.cotizacion);
    if (!memo || vistos.has(memo)) return false;
    vistos.add(memo);
    return true;
  });

  const resultados = [];
  for (const o of unicas) {
    try {
      resultados.push(await procesarOrden(o));
    } catch (e) {
      resultados.push({ numero_oc: memoDeUrl(o.cotizacion), accion: "error", error: e.message });
    }
  }

  const creadas = resultados.filter((r) => r.accion === "creada").length;
  const actualizadas = resultados.filter((r) => r.accion === "actualizada" && (r.campos.length || r.cotizacionAdjuntada)).length;
  const sinCambios = resultados.filter((r) => r.accion === "actualizada" && !r.campos.length && !r.cotizacionAdjuntada).length;
  const conError = resultados.filter((r) => r.accion === "error");

  return res.status(200).json({
    total: unicas.length, creadas, actualizadas, sinCambios,
    errores: conError.length, detalleErrores: conError,
  });
}
