import { supabase, readJsonBody } from "./_supabase.js";
import { verifyToken, parseCookie } from "./_session.js";
import { valoresUF } from "./_uf.js";

// Menu "Proyectos" (Fase 1, ver docs/superpowers/specs/2026-10-08-proyectos-fase1-design.md).
// El catalogo `proyectos` (el mismo que se elige en Nueva OC) es la ficha
// del proyecto; cada proyecto tiene Ordenes de Trabajo (proyecto_ot) y una
// bitacora de solo-agregar (proyecto_bitacora). No hay aprobaciones propias:
// el gasto se aprueba en la OC y aca solo se hace seguimiento, sumando las
// OC del proyecto convertidas a UF. Las tablas viejas seguimiento_proyectos*
// quedan como respaldo de solo lectura (migradas a OT de "Mantención General").
// Herramienta interna: solo personal con correo @patagonica.cl.

const ESTADOS_PROYECTO = ["Planificado", "En ejecución", "Pausado", "En recepción", "Cerrado", "Cancelado"];
const ESTADOS_OT = ["Pendiente", "En ejecución", "Terminada", "Cancelada"];

// Estados de OC que todavia no comprometen gasto (o ya no lo hacen).
const OC_NO_COMPROMETE = new Set(["Borrador", "Pendiente aprobación", "Pendiente", "Anulado", "Rechazado"]);
const OC_POR_APROBAR = new Set(["Pendiente aprobación", "Pendiente"]);
const OC_FACTURADA = new Set(["Facturada", "Factura Pendiente de Aprobación", "Factura Aprobada", "Completada", "Proceso de Pago", "Pagado"]);

const CAMPOS_PROYECTO = [
  "nombre", "sigla", "tipo", "prioridad", "descripcion", "ubicacion", "solicitante", "jefe_proyecto",
  "ejecutor_tipo", "ejecutor_proveedor_id", "ejecutor_interno", "presupuesto_uf",
  "fecha_inicio_plan", "fecha_termino_plan", "fecha_inicio_real", "fecha_termino_real",
  "estado_proyecto", "avance_pct",
];
const CAMPOS_OT = [
  "descripcion", "ubicacion", "responsable", "ejecutor_tipo", "ejecutor_proveedor_id", "ejecutor_interno",
  "fecha_inicio", "fecha_limite", "fecha_culminacion", "estado",
];

// FK explicitas: proyecto_ot/proyecto_bitacora crean rutas indirectas entre
// estas tablas y PostgREST podria considerar ambiguo el embed sin el hint.
const SELECT_PROYECTO = "*, proveedores!proyectos_ejecutor_proveedor_id_fkey(id, razon_social, rut)";
const SELECT_OT = "*, proveedores!proyecto_ot_ejecutor_proveedor_id_fkey(id, razon_social, rut)";

function hoy() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
}

function vacioANull(v) {
  return v === "" || v === undefined ? null : v;
}

// Toma solo los campos permitidos del body y normaliza vacios/numeros.
function limpiarCampos(body, permitidos) {
  const out = {};
  for (const k of permitidos) {
    if (body[k] === undefined) continue;
    let v = vacioANull(typeof body[k] === "string" ? body[k].trim() : body[k]);
    if (k === "presupuesto_uf") v = v === null ? null : Number(v);
    if (k === "avance_pct") v = v === null ? 0 : Math.round(Number(v));
    if (k === "sigla" && v !== null) v = String(v).toUpperCase();
    out[k] = v;
  }
  // Ejecutor: interno -> sin proveedor; contratista -> sin texto libre.
  if (out.ejecutor_tipo === "interno") out.ejecutor_proveedor_id = null;
  if (out.ejecutor_tipo === "contratista") out.ejecutor_interno = null;
  if (out.ejecutor_tipo === null) { out.ejecutor_proveedor_id = null; out.ejecutor_interno = null; }
  return out;
}

function validarCampos(f, estadosValidos, campoEstado) {
  if (f.presupuesto_uf !== undefined && f.presupuesto_uf !== null && (!isFinite(f.presupuesto_uf) || f.presupuesto_uf < 0)) {
    return "El presupuesto debe ser un número mayor o igual a 0";
  }
  if (f.avance_pct !== undefined && (!isFinite(f.avance_pct) || f.avance_pct < 0 || f.avance_pct > 100)) {
    return "El avance debe estar entre 0 y 100";
  }
  // Sigla del codigo de proyecto (OT + sigla + correlativo, ej. OTGL-006).
  if (f.sigla !== undefined && f.sigla !== null && !/^[A-Z]{2,4}$/.test(f.sigla)) {
    return "La sigla debe tener entre 2 y 4 letras (sin tildes ni números)";
  }
  if (f[campoEstado] !== undefined && !estadosValidos.includes(f[campoEstado])) {
    return "Estado no válido";
  }
  if (f.ejecutor_tipo !== undefined && f.ejecutor_tipo !== null && !["interno", "contratista"].includes(f.ejecutor_tipo)) {
    return "Tipo de ejecutor no válido";
  }
  return null;
}

// Un contratista debe existir (y estar activo) en el catalogo de proveedores.
async function validarContratista(db, f, actual) {
  const tipo = f.ejecutor_tipo !== undefined ? f.ejecutor_tipo : actual && actual.ejecutor_tipo;
  if (tipo !== "contratista") return null;
  const provId = f.ejecutor_proveedor_id !== undefined ? f.ejecutor_proveedor_id : actual && actual.ejecutor_proveedor_id;
  if (!provId) return "Selecciona el contratista desde el catálogo de proveedores";
  const { data } = await db.from("proveedores").select("id").eq("id", provId).eq("activo", true).maybeSingle();
  if (!data) return "El contratista debe estar ingresado (y activo) en el catálogo de proveedores";
  return null;
}

async function nombreDuplicado(db, empresaId, nombre, excluirId) {
  let q = db.from("proyectos").select("id").eq("empresa_id", empresaId).eq("activo", true).ilike("nombre", nombre);
  if (excluirId) q = q.neq("id", excluirId);
  const { data } = await q;
  return (data || []).length > 0;
}

// Suma las OC del proyecto en UF (neto). Devuelve el resumen y, si se pide,
// el detalle de cada OC con su monto convertido.
async function resumenFinanciero(db, proyectoIds, conDetalle) {
  const resumen = {};
  for (const id of proyectoIds) {
    resumen[id] = { comprometido_uf: 0, facturado_uf: 0, por_aprobar_uf: 0, n_oc: 0, sin_convertir: 0 };
  }
  if (!proyectoIds.length) return { resumen, ordenes: [], ufHoy: (await valoresUF(db, [])).ufHoy };

  const { data: ocs, error } = await db
    .from("ordenes_compra")
    .select("id, proyecto_id, numero_oc, numero_oc_acquisys, fecha, titulo, estado, moneda, monto_neto, monto_total, cuota_numero, cuota_total, proveedores(razon_social)")
    .in("proyecto_id", proyectoIds)
    .eq("activo", true)
    .order("fecha", { ascending: false });
  if (error) throw new Error(error.message);

  const fechasCLP = (ocs || []).filter((o) => o.moneda === "CLP").map((o) => o.fecha);
  const { porFecha, ufHoy } = await valoresUF(db, fechasCLP);

  const detalle = [];
  for (const o of ocs || []) {
    const neto = Number(o.monto_neto ?? o.monto_total ?? 0);
    let netoUF = null;
    if (o.moneda === "UF") netoUF = neto;
    else if (o.moneda === "CLP" && porFecha[o.fecha]) netoUF = neto / porFecha[o.fecha];
    const r = resumen[o.proyecto_id];
    r.n_oc += 1;
    if (netoUF === null) {
      r.sin_convertir += 1;
    } else {
      if (!OC_NO_COMPROMETE.has(o.estado)) r.comprometido_uf += netoUF;
      if (OC_FACTURADA.has(o.estado)) r.facturado_uf += netoUF;
      if (OC_POR_APROBAR.has(o.estado)) r.por_aprobar_uf += netoUF;
    }
    if (conDetalle) {
      detalle.push({
        id: o.id, numero_oc: o.numero_oc_acquisys || o.numero_oc, fecha: o.fecha, titulo: o.titulo,
        estado: o.estado, moneda: o.moneda, monto_neto: neto, neto_uf: netoUF,
        valor_uf: o.moneda === "CLP" ? porFecha[o.fecha] || null : null,
        proveedor: o.proveedores ? o.proveedores.razon_social : null,
        cuota: o.cuota_total ? o.cuota_numero + "/" + o.cuota_total : null,
      });
    }
  }
  return { resumen, ordenes: detalle, ufHoy };
}

async function registrarSistema(db, proyectoId, otId, texto, usuario) {
  await db.from("proyecto_bitacora").insert({ proyecto_id: proyectoId, ot_id: otId || null, tipo: "sistema", texto, usuario });
}

export default async function handler(req, res) {
  const db = supabase();
  const session = verifyToken(parseCookie(req.headers.cookie, "ocsys_token"), process.env.SESSION_SECRET || "");

  if (!session || !(session.usuario || "").toLowerCase().endsWith("@patagonica.cl")) {
    return res.status(403).json({ error: "Esta función es solo para personal de Patagónica" });
  }
  const usuario = session.usuario;

  try {
    if (req.method === "GET") {
      // Usuarios internos activos, para el selector "Jefe de proyecto".
      if (req.query.usuarios) {
        const { data, error } = await db.from("usuarios").select("usuario, nombre, apellido").eq("activo", true).ilike("usuario", "%@patagonica.cl").order("nombre");
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ usuarios: data });
      }

      // Ficha completa de un proyecto.
      if (req.query.id) {
        const { data: proyecto, error } = await db.from("proyectos").select(SELECT_PROYECTO).eq("id", req.query.id).maybeSingle();
        if (error) return res.status(500).json({ error: error.message });
        if (!proyecto) return res.status(404).json({ error: "Proyecto no encontrado" });
        const [{ data: ots, error: e1 }, { data: bitacora, error: e2 }, fin] = await Promise.all([
          db.from("proyecto_ot").select(SELECT_OT).eq("proyecto_id", proyecto.id).eq("activo", true).order("created_at", { ascending: false }),
          db.from("proyecto_bitacora").select("*").eq("proyecto_id", proyecto.id).order("created_at", { ascending: true }),
          resumenFinanciero(db, [proyecto.id], true),
        ]);
        if (e1 || e2) return res.status(500).json({ error: (e1 || e2).message });
        return res.status(200).json({
          proyecto: { ...proyecto, ...fin.resumen[proyecto.id] },
          ots, bitacora, ordenes: fin.ordenes, uf_hoy: fin.ufHoy,
        });
      }

      // Cartera de la empresa. "Contenedor" (sin codigo) no es un proyecto real.
      const empresaId = Number(req.query.empresa_id) || 1;
      const { data: proyectos, error } = await db
        .from("proyectos")
        .select(SELECT_PROYECTO + ", proyecto_ot!proyecto_ot_proyecto_id_fkey(id, estado, activo)")
        .eq("empresa_id", empresaId)
        .eq("activo", true)
        .not("codigo", "is", null)
        .order("codigo", { ascending: true });
      if (error) return res.status(500).json({ error: error.message });
      const fin = await resumenFinanciero(db, proyectos.map((p) => p.id), false);
      const lista = proyectos.map((p) => {
        const ots = (p.proyecto_ot || []).filter((o) => o.activo);
        const { proyecto_ot, ...resto } = p;
        return {
          ...resto, ...fin.resumen[p.id],
          ot_total: ots.length,
          ot_abiertas: ots.filter((o) => o.estado === "Pendiente" || o.estado === "En ejecución").length,
        };
      });
      return res.status(200).json({ proyectos: lista, uf_hoy: fin.ufHoy });
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);

      // Comentario en la bitacora (del proyecto o de una OT puntual).
      if (req.query.bitacora === "1") {
        const texto = (body.texto || "").trim();
        if (!texto) return res.status(400).json({ error: "texto es obligatorio" });
        if (!body.proyecto_id) return res.status(400).json({ error: "proyecto_id es obligatorio" });
        const { data, error } = await db
          .from("proyecto_bitacora")
          .insert({ proyecto_id: body.proyecto_id, ot_id: body.ot_id || null, tipo: "comentario", texto, usuario })
          .select()
          .single();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(201).json({ entrada: data });
      }

      // Nueva Orden de Trabajo (el codigo OT lo asigna el trigger).
      if (req.query.ot === "1") {
        if (!body.proyecto_id) return res.status(400).json({ error: "proyecto_id es obligatorio" });
        const campos = limpiarCampos(body, CAMPOS_OT);
        if (!campos.descripcion) return res.status(400).json({ error: "La descripción es obligatoria" });
        const errVal = validarCampos(campos, ESTADOS_OT, "estado") || await validarContratista(db, campos, null);
        if (errVal) return res.status(400).json({ error: errVal });
        const { data: proyecto } = await db.from("proyectos").select("id, empresa_id").eq("id", body.proyecto_id).eq("activo", true).maybeSingle();
        if (!proyecto) return res.status(404).json({ error: "Proyecto no encontrado" });
        if (campos.estado === "Terminada" && !campos.fecha_culminacion) campos.fecha_culminacion = hoy();
        const { data, error } = await db
          .from("proyecto_ot")
          .insert({ ...campos, proyecto_id: proyecto.id, empresa_id: proyecto.empresa_id, creado_por_usuario: usuario })
          .select(SELECT_OT)
          .single();
        if (error) return res.status(500).json({ error: error.message });
        await registrarSistema(db, proyecto.id, data.id, "Tarea " + data.codigo + " creada", usuario);
        return res.status(201).json({ ot: data });
      }

      // Nuevo proyecto (entra al catalogo: tambien aparece en Nueva OC).
      const empresaId = Number(body.empresa_id);
      if (!empresaId) return res.status(400).json({ error: "empresa_id es obligatorio" });
      const campos = limpiarCampos(body, CAMPOS_PROYECTO);
      if (!campos.nombre) return res.status(400).json({ error: "El nombre del proyecto es obligatorio" });
      if (campos.nombre.toLowerCase() === "contenedor") return res.status(400).json({ error: "Ese nombre está reservado" });
      if (!campos.estado_proyecto) campos.estado_proyecto = "Planificado";
      const errVal = validarCampos(campos, ESTADOS_PROYECTO, "estado_proyecto") || await validarContratista(db, campos, null);
      if (errVal) return res.status(400).json({ error: errVal });
      if (await nombreDuplicado(db, empresaId, campos.nombre)) {
        return res.status(400).json({ error: "Ya existe un proyecto con ese nombre en esta empresa" });
      }
      const { data, error } = await db
        .from("proyectos")
        .insert({ ...campos, empresa_id: empresaId, creado_por_usuario: usuario })
        .select(SELECT_PROYECTO)
        .single();
      if (error) return res.status(500).json({ error: error.message });
      await registrarSistema(db, data.id, null, "Proyecto " + data.codigo + " creado", usuario);
      return res.status(201).json({ proyecto: data });
    }

    if (req.method === "PUT") {
      const body = await readJsonBody(req);

      // Actualizar una OT; los cambios de estado quedan en la bitacora.
      if (req.query.ot_id) {
        const { data: actual } = await db.from("proyecto_ot").select("*").eq("id", req.query.ot_id).eq("activo", true).maybeSingle();
        if (!actual) return res.status(404).json({ error: "Tarea no encontrada" });
        const campos = limpiarCampos(body, CAMPOS_OT);
        if (campos.descripcion === null) return res.status(400).json({ error: "La descripción de la tarea es obligatoria" });
        const errVal = validarCampos(campos, ESTADOS_OT, "estado") || await validarContratista(db, campos, actual);
        if (errVal) return res.status(400).json({ error: errVal });
        if (campos.estado === "Terminada" && !actual.fecha_culminacion && campos.fecha_culminacion === undefined) {
          campos.fecha_culminacion = hoy();
        }
        const { data, error } = await db
          .from("proyecto_ot")
          .update({ ...campos, updated_at: new Date().toISOString() })
          .eq("id", actual.id)
          .select(SELECT_OT)
          .single();
        if (error) return res.status(500).json({ error: error.message });
        if (campos.estado !== undefined && campos.estado !== actual.estado) {
          await registrarSistema(db, actual.proyecto_id, actual.id, "Tarea " + actual.codigo + ": " + actual.estado + " → " + campos.estado, usuario);
        }
        return res.status(200).json({ ot: data });
      }

      // Actualizar la ficha del proyecto.
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "id es obligatorio" });
      const { data: actual } = await db.from("proyectos").select("*").eq("id", id).eq("activo", true).maybeSingle();
      if (!actual) return res.status(404).json({ error: "Proyecto no encontrado" });
      const campos = limpiarCampos(body, CAMPOS_PROYECTO);
      if (actual.es_permanente) {
        // Mantencion General es permanente: no se renombra ni se cierra, y
        // su sigla es la de la empresa (OTPA, OTCM, OTEV).
        delete campos.nombre;
        delete campos.sigla;
        if (campos.estado_proyecto && !["En ejecución", "Pausado"].includes(campos.estado_proyecto)) {
          return res.status(400).json({ error: "Mantención General es permanente: no se puede cerrar ni cancelar" });
        }
      }
      if (campos.nombre === null) return res.status(400).json({ error: "El nombre del proyecto es obligatorio" });
      if (campos.sigla === null) delete campos.sigla;
      if (campos.nombre && campos.nombre.toLowerCase() === "contenedor") return res.status(400).json({ error: "Ese nombre está reservado" });
      if (campos.estado_proyecto === null) delete campos.estado_proyecto;
      const errVal = validarCampos(campos, ESTADOS_PROYECTO, "estado_proyecto") || await validarContratista(db, campos, actual);
      if (errVal) return res.status(400).json({ error: errVal });
      if (campos.nombre && campos.nombre !== actual.nombre && await nombreDuplicado(db, actual.empresa_id, campos.nombre, actual.id)) {
        return res.status(400).json({ error: "Ya existe un proyecto con ese nombre en esta empresa" });
      }
      // Fechas reales se completan solas al pasar de estado, si estaban vacias.
      const inicioReal = campos.fecha_inicio_real !== undefined ? campos.fecha_inicio_real : actual.fecha_inicio_real;
      const terminoReal = campos.fecha_termino_real !== undefined ? campos.fecha_termino_real : actual.fecha_termino_real;
      if (campos.estado_proyecto === "En ejecución" && !inicioReal) campos.fecha_inicio_real = hoy();
      if (campos.estado_proyecto === "Cerrado" && !terminoReal) campos.fecha_termino_real = hoy();
      if (campos.estado_proyecto === "Cerrado" && campos.avance_pct === undefined) campos.avance_pct = 100;

      const { data, error } = await db
        .from("proyectos")
        .update({ ...campos, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select(SELECT_PROYECTO)
        .single();
      if (error) return res.status(500).json({ error: error.message });

      const cambios = [];
      if (campos.estado_proyecto !== undefined && campos.estado_proyecto !== actual.estado_proyecto) {
        cambios.push("Estado: " + actual.estado_proyecto + " → " + campos.estado_proyecto);
      }
      if (campos.avance_pct !== undefined && campos.avance_pct !== actual.avance_pct) {
        cambios.push("Avance: " + actual.avance_pct + "% → " + campos.avance_pct + "%");
      }
      if (campos.presupuesto_uf !== undefined && Number(campos.presupuesto_uf ?? -1) !== Number(actual.presupuesto_uf ?? -1)) {
        cambios.push("Presupuesto: " + (actual.presupuesto_uf ?? "—") + " UF → " + (campos.presupuesto_uf ?? "—") + " UF");
      }
      if (campos.nombre && campos.nombre !== actual.nombre) {
        cambios.push("Nombre: " + actual.nombre + " → " + campos.nombre);
      }
      // El trigger recalcula el codigo (y el de sus tareas) si cambio la sigla.
      if (data.codigo !== actual.codigo) {
        cambios.push("Código: " + actual.codigo + " → " + data.codigo);
      }
      for (const c of cambios) await registrarSistema(db, id, null, c, usuario);
      return res.status(200).json({ proyecto: data });
    }

    if (req.method === "DELETE") {
      // Eliminar (soft) una OT.
      if (req.query.ot_id) {
        const { data: actual } = await db.from("proyecto_ot").select("id, proyecto_id, codigo").eq("id", req.query.ot_id).eq("activo", true).maybeSingle();
        if (!actual) return res.status(404).json({ error: "Tarea no encontrada" });
        const { error } = await db
          .from("proyecto_ot")
          .update({ activo: false, eliminado_por: usuario, eliminado_en: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", actual.id);
        if (error) return res.status(500).json({ error: error.message });
        await registrarSistema(db, actual.proyecto_id, actual.id, "Tarea " + actual.codigo + " eliminada", usuario);
        return res.status(200).json({ ok: true });
      }

      // Eliminar un proyecto: solo si no tiene OC ni OT y no es permanente
      // (tambien desaparece del desplegable de Nueva OC).
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "id es obligatorio" });
      const { data: actual } = await db.from("proyectos").select("id, es_permanente").eq("id", id).eq("activo", true).maybeSingle();
      if (!actual) return res.status(404).json({ error: "Proyecto no encontrado" });
      if (actual.es_permanente) return res.status(400).json({ error: "Mantención General es permanente: no se puede eliminar" });
      const [{ count: nOc }, { count: nOt }] = await Promise.all([
        db.from("ordenes_compra").select("id", { count: "exact", head: true }).eq("proyecto_id", id).eq("activo", true),
        db.from("proyecto_ot").select("id", { count: "exact", head: true }).eq("proyecto_id", id).eq("activo", true),
      ]);
      if (nOc > 0) return res.status(400).json({ error: "El proyecto tiene OC asociadas: ciérralo o cancélalo en vez de eliminarlo" });
      if (nOt > 0) return res.status(400).json({ error: "El proyecto tiene tareas: elimínalas primero o cancela el proyecto" });
      const { error } = await db.from("proyectos").update({ activo: false, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST, PUT, DELETE");
    return res.status(405).json({ error: "Método no permitido" });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Error de servidor" });
  }
}
