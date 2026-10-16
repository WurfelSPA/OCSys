import { supabase, readJsonBody } from "./_supabase.js";
import { verifyToken, parseCookie } from "./_session.js";
import { valoresUF } from "./_uf.js";

// Menu "OT Mantencion" (Fase A, ver
// docs/superpowers/specs/2026-10-09-ot-mantencion-fase-a-design.md). Tickets
// de mantencion reactiva de arriendo (no confundir con "Proyectos", que es
// capital/remodelacion). Sin correo/IA todavia: el ingreso es por Registro
// rapido. Herramienta interna: solo personal con correo @patagonica.cl.

const UMBRAL_APROBACION_GASTO_DEFAULT = 500000; // CLP, editable en Configuracion en una fase futura

// Toda OT nueva (bot o Registro rapido) queda con Andres Sanchez (Jefe de
// Operaciones) como responsable por defecto -- pedido del usuario, para no
// dejar OTs "sin dueño" apenas se crean.
const RESPONSABLE_DEFECTO_USUARIO = "asanchez@patagonica.cl";
async function responsableDefecto(db) {
  const { data } = await db.from("usuarios").select("id").eq("usuario", RESPONSABLE_DEFECTO_USUARIO).maybeSingle();
  return data ? data.id : null;
}

// Tabla 4.11 del spec: categoria -> prioridad base sugerida / cargo sugerido.
const CATEGORIAS = {
  "Techumbre y filtraciones": { subcategorias: ["Gotera activa", "Humedad", "Canaletas y bajadas", "Planchas dañadas"], cargo: "Arrendador" },
  "Eléctrico": { subcategorias: ["Corte total", "Corte parcial", "Tablero", "Enchufes", "Iluminación interior"], cargo: "Por definir" },
  "Iluminación exterior": { subcategorias: ["Postes", "Focos de área común"], cargo: "Arrendador" },
  "Agua y sanitario": { subcategorias: ["Sin agua", "Fuga", "Alcantarillado", "Baño inutilizable", "Cámaras"], cargo: "Por definir" },
  "Accesos y seguridad": { subcategorias: ["Portón", "Cortina metálica", "Cerradura", "Control de acceso", "Cámaras", "Cerco"], cargo: "Por definir" },
  "Ascensores": { subcategorias: ["Detenido", "Falla intermitente", "Persona atrapada"], cargo: "Arrendador" },
  "Obra civil": { subcategorias: ["Muros", "Pisos", "Pavimentos", "Vidrios", "Puertas"], cargo: "Por definir" },
  "Climatización": { subcategorias: ["Equipo sin funcionar", "Ruido", "Fuga"], cargo: "Por definir" },
  "Incendio y emergencias": { subcategorias: ["Extintores", "Red húmeda", "Alarma", "Olor a gas o quemado"], cargo: "Arrendador" },
  "Áreas comunes y aseo": { subcategorias: ["Basura", "Jardines", "Estacionamientos", "Señalética", "Calles"], cargo: "Arrendador" },
  "Plagas": { subcategorias: ["Roedores", "Insectos"], cargo: "Por definir" },
  "Solicitud de servicio": { subcategorias: ["Tarjetas o llaves", "Permiso de ingreso o mudanza", "Estacionamiento", "Certificados"], cargo: "No aplica" },
  "Reclamo de convivencia": { subcategorias: ["Ruido", "Mal uso de estacionamientos", "Vecinos"], cargo: "No aplica" },
  "Otro": { subcategorias: [], cargo: "Por definir" },
};

// El campo "Impacto" ya no se pide en el Registro rápido: se deriva de la
// categoría elegida (section 7.1 sigue usando impacto x urgencia -> prioridad).
const CATEGORIA_IMPACTO = {
  "Techumbre y filtraciones": "Operación afectada",
  "Eléctrico": "Operación detenida",
  "Iluminación exterior": "Sin impacto operativo",
  "Agua y sanitario": "Operación detenida",
  "Accesos y seguridad": "Seguridad de personas",
  "Ascensores": "Operación detenida",
  "Obra civil": "Operación afectada",
  "Climatización": "Operación afectada",
  "Incendio y emergencias": "Seguridad de personas",
  "Áreas comunes y aseo": "Sin impacto operativo",
  "Plagas": "Operación afectada",
  "Solicitud de servicio": "Sin impacto operativo",
  "Reclamo de convivencia": "Sin impacto operativo",
};
const CATEGORIA_IMPACTO_DEFAULT = "Operación afectada";

// El bot de WhatsApp/Telegram usa un menu simplificado de categorias (mas
// facil de elegir en un chat) que no coincide textualmente con las de
// CATEGORIAS/CATEGORIA_IMPACTO -- sin este mapeo, categorias como "Seguridad"
// caian al default "Operacion afectada" (P3) en vez de "Seguridad de
// personas" (P1), subestimando la prioridad real.
const CATEGORIA_BOT_A_INTERNA = {
  "Filtración Techumbre": "Techumbre y filtraciones",
  "Filtración Agua Potable": "Agua y sanitario",
  "Filtración Alcantarillado": "Agua y sanitario",
  "Eléctrico": "Eléctrico",
  "Pisos": "Obra civil",
  "Seguridad": "Accesos y seguridad",
  "Otro": "Otro",
};

// Matriz impacto x urgencia -> prioridad (seccion 7.1 del spec).
const MATRIZ_PRIORIDAD = {
  "Seguridad de personas": { "En curso": "P1", "Estable": "P1" },
  "Operación detenida": { "En curso": "P1", "Estable": "P2" },
  "Operación afectada": { "En curso": "P2", "Estable": "P3" },
  "Sin impacto operativo": { "En curso": "P3", "Estable": "P4" },
};

// SLA estandar (seccion 7.2). P1 es corrido 24/7; el resto, horario habil.
const SLA_ESTANDAR = {
  P1: { respuesta_horas: 1, solucion_horas: 72, habil: false },
  P2: { respuesta_horas: 4, solucion_horas: 2 * 9.5, habil: true },
  P3: { respuesta_horas: 9.5, solucion_horas: 10 * 9.5, habil: true },
  P4: { respuesta_horas: 3 * 9.5, solucion_horas: 30 * 24, habil: false },
};

const HORARIO_INICIO = 8.5, HORARIO_FIN = 18;
const SANTIAGO_TZ = "America/Santiago";

// Vercel corre las funciones en UTC -- "horario habil" (8:30-18:00) tiene que
// calcularse en la hora de pared de Santiago, no en la del servidor, o el
// SLA queda corrido varias horas (y con el cambio de horario de verano
// chileno, un offset fijo tampoco sirve). Estas 3 funciones traducen entre
// un instante real (Date/UTC) y sus "partes" en zona Santiago.
function offsetMinutosSantiago(fechaUtc) {
  const parte = new Intl.DateTimeFormat("en-US", { timeZone: SANTIAGO_TZ, timeZoneName: "longOffset" })
    .formatToParts(fechaUtc).find((p) => p.type === "timeZoneName").value; // "GMT-03:00" o "GMT-04:00"
  const m = parte.match(/GMT([+-])(\d+)(?::(\d+))?/);
  if (!m) return -180;
  const signo = m[1] === "-" ? -1 : 1;
  return signo * (Number(m[2]) * 60 + Number(m[3] || 0));
}

function aPartesSantiago(fechaUtc) {
  const partes = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone: SANTIAGO_TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  }).formatToParts(fechaUtc).forEach((p) => { partes[p.type] = p.value; });
  return {
    year: Number(partes.year), month: Number(partes.month), day: Number(partes.day),
    hour: partes.hour === "24" ? 0 : Number(partes.hour), minute: Number(partes.minute),
    weekday: partes.weekday,
  };
}

function desdePartesSantiago(p) {
  const comoSiFueraUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const offset = offsetMinutosSantiago(new Date(comoSiFueraUtc));
  return new Date(comoSiFueraUtc - offset * 60000);
}

// Dia siguiente a las partes dadas, a las 08:30 -- usa Date.UTC solo como
// calendario (mediodia arbitrario) para resolver fin de mes/año, y vuelve a
// leer el resultado en zona Santiago.
function diaSiguienteSantiago(p) {
  const instanteAux = new Date(Date.UTC(p.year, p.month - 1, p.day + 1, 12, 0));
  const pAux = aPartesSantiago(instanteAux);
  return { ...pAux, hour: 8, minute: 30 };
}

function esHabilSantiago(partes) {
  return partes.weekday !== "Sun" && partes.weekday !== "Sat"; // feriados de Chile no se consideran en esta fase
}

// Avanza `minutos` minutos en horario habil (lun-vie 8:30-18:00, hora Chile).
function agregarMinutosHabiles(desde, minutos) {
  let actual = new Date(desde);
  let restante = minutos;
  while (restante > 0) {
    const p = aPartesSantiago(actual);
    if (esHabilSantiago(p)) {
      const horaDecimal = p.hour + p.minute / 60;
      if (horaDecimal < HORARIO_INICIO) { actual = desdePartesSantiago({ ...p, hour: 8, minute: 30 }); continue; }
      if (horaDecimal >= HORARIO_FIN) { actual = desdePartesSantiago(diaSiguienteSantiago(p)); continue; }
      const minutosHastaFin = Math.round((HORARIO_FIN - horaDecimal) * 60);
      const avance = Math.min(restante, minutosHastaFin);
      actual = new Date(actual.getTime() + avance * 60000);
      restante -= avance;
      if (restante > 0) { actual = desdePartesSantiago(diaSiguienteSantiago(aPartesSantiago(actual))); }
    } else {
      actual = desdePartesSantiago(diaSiguienteSantiago(p));
    }
  }
  return actual;
}

function agregarHoras(desde, horas, habil) {
  if (!habil) return new Date(new Date(desde).getTime() + horas * 3600000);
  return agregarMinutosHabiles(desde, horas * 60);
}

function calcularPrioridad(impacto, urgencia) {
  return (MATRIZ_PRIORIDAD[impacto] || {})[urgencia] || null;
}

// SLA del contrato prevalece si es mas exigente (numero menor) que el
// estandar -- entre varios contratos afectados, se usa el mas exigente de
// todos (seccion 7.2 del spec).
async function calcularFechasLimite(db, prioridad, fechaReporte, contratoIds) {
  const estandar = SLA_ESTANDAR[prioridad];
  if (!estandar) return { fecha_limite_respuesta: null, fecha_limite_solucion: null };
  let respuestaHoras = estandar.respuesta_horas;
  let solucionHoras = estandar.solucion_horas;
  if (contratoIds && contratoIds.length) {
    const { data: contratos } = await db
      .from("contrato_operaciones")
      .select("sla_respuesta_horas, sla_solucion_dias")
      .in("id", contratoIds);
    for (const c of contratos || []) {
      if (c.sla_respuesta_horas != null) respuestaHoras = Math.min(respuestaHoras, Number(c.sla_respuesta_horas));
      if (c.sla_solucion_dias != null) solucionHoras = Math.min(solucionHoras, Number(c.sla_solucion_dias) * 24);
    }
  }
  const base = fechaReporte ? new Date(fechaReporte) : new Date();
  return {
    fecha_limite_respuesta: agregarHoras(base, respuestaHoras, estandar.habil).toISOString(),
    fecha_limite_solucion: agregarHoras(base, solucionHoras, estandar.habil).toISOString(),
  };
}

// R2-R4: deriva clientes/contratos vigentes a partir de la ubicacion + fecha.
async function resolverClientesContratos(db, ubicacionTipo, ubicacionId, fecha) {
  if (!ubicacionTipo || !ubicacionId) return { unidadIds: [], clienteIds: [], contratoIds: [], vacante: false };
  let unidadIds = [];
  if (ubicacionTipo === "unidad") {
    unidadIds = [ubicacionId];
  } else if (ubicacionTipo === "edificio") {
    const { data } = await db.from("unidad").select("id").eq("edificio_id", ubicacionId);
    unidadIds = (data || []).map((u) => u.id);
  } else if (ubicacionTipo === "sitio") {
    const { data } = await db.from("unidad").select("id").eq("sitio_id", ubicacionId);
    unidadIds = (data || []).map((u) => u.id);
  } else if (ubicacionTipo === "area_comun") {
    const { data } = await db.from("area_comun").select("unidades_que_atiende").eq("id", ubicacionId).maybeSingle();
    unidadIds = (data && data.unidades_que_atiende) || [];
  }
  if (!unidadIds.length) return { unidadIds, clienteIds: [], contratoIds: [], vacante: true };

  const f = (fecha || new Date().toISOString()).slice(0, 10);
  const { data: vigentes } = await db
    .from("contrato_unidad")
    .select("contrato_id, unidad_id, desde, hasta, contrato_operaciones(id, cliente_id)")
    .in("unidad_id", unidadIds)
    .lte("desde", f)
    .or("hasta.is.null,hasta.gte." + f);

  const clienteIds = [...new Set((vigentes || []).map((v) => v.contrato_operaciones?.cliente_id).filter(Boolean))];
  const contratoIds = [...new Set((vigentes || []).map((v) => v.contrato_id).filter(Boolean))];
  return { unidadIds, clienteIds, contratoIds, vacante: contratoIds.length === 0 };
}

// Centro de costo con presupuesto asignado: ¿el gasto deja el saldo en
// negativo, o supera igual el umbral global? (seccion actualizada del spec).
async function requiereAprobacionGasto(db, empresaId, centroCostoCodigo, costoEstimadoClp) {
  if (!costoEstimadoClp) return false;
  if (costoEstimadoClp > UMBRAL_APROBACION_GASTO_DEFAULT) return true;
  if (!centroCostoCodigo) return false;
  const { data: cc } = await db.from("centros_costo").select("presupuesto_asignado_uf").eq("codigo", centroCostoCodigo).eq("empresa_id", empresaId).maybeSingle();
  if (!cc || cc.presupuesto_asignado_uf == null) return false;

  const [{ data: ocs }, { data: costosOt }] = await Promise.all([
    db.from("ordenes_compra").select("monto_neto, moneda, fecha").eq("centro_costo_codigo", centroCostoCodigo).eq("empresa_id", empresaId).eq("activo", true)
      .not("estado", "in", "(Borrador,\"Pendiente aprobación\",Anulado,Rechazado)"),
    db.from("ot_costo").select("monto_clp, fecha, ot_mantencion!inner(centro_costo_codigo, empresa_id, estado)")
      .eq("ot_mantencion.centro_costo_codigo", centroCostoCodigo).eq("ot_mantencion.empresa_id", empresaId)
      .not("ot_mantencion.estado", "in", "(Anulada)"),
  ]);
  const fechasCLP = (ocs || []).filter((o) => o.moneda === "CLP").map((o) => o.fecha)
    .concat((costosOt || []).map((c) => c.fecha).filter(Boolean));
  const { porFecha, ufHoy } = await valoresUF(db, fechasCLP);
  let comprometidoUf = 0;
  for (const o of ocs || []) {
    const neto = Number(o.monto_neto) || 0;
    comprometidoUf += o.moneda === "UF" ? neto : neto / (porFecha[o.fecha] || ufHoy || 1);
  }
  for (const c of costosOt || []) {
    comprometidoUf += (Number(c.monto_clp) || 0) / (porFecha[c.fecha] || ufHoy || 1);
  }
  const costoEstimadoUf = costoEstimadoClp / (ufHoy || 1);
  const disponible = Number(cc.presupuesto_asignado_uf) - comprometidoUf;
  return disponible - costoEstimadoUf < 0;
}

async function registrarBitacora(db, otId, texto, usuario, tipo) {
  await db.from("ot_bitacora").insert({ ot_id: otId, tipo: tipo || "sistema", texto, usuario });
}

function vacioANull(v) {
  return v === "" || v === undefined ? null : v;
}

function normalizarRut(r) {
  return (r || "").toUpperCase().replace(/[^0-9K]/g, "");
}

// Compara solo los ultimos 9 digitos -- asi da lo mismo si el contacto quedo
// guardado como "+56 9 1234 5678", "56912345678" o "912345678".
function normalizarTelefono(t) {
  const digitos = (t || "").replace(/\D/g, "");
  return digitos.slice(-9);
}

// Busca el cliente por RUT (o, si no hay rut, por telefono contra
// contacto_operaciones) y devuelve sus unidades vigentes hoy + su razon
// social (para poder saludar por nombre antes de pedir el detalle). null si
// no se encuentra el cliente o no tiene ninguna unidad vigente -- ambos
// casos se tratan igual de cara al arrendatario ("RUT no encontrado").
function normalizarNombre(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9\s]/g, "").trim();
}

async function resolverUnidadPorIdentificador(db, { rut, telefono, nombre }, fecha) {
  let clienteId = null, razonSocial = null;

  const rutNorm = normalizarRut(rut);
  if (rutNorm) {
    const { data: clientes } = await db.from("cliente_operaciones").select("id, rut, razon_social");
    const cliente = (clientes || []).find((c) => normalizarRut(c.rut) === rutNorm);
    if (cliente) { clienteId = cliente.id; razonSocial = cliente.razon_social; }
  }

  if (!clienteId) {
    const telNorm = normalizarTelefono(telefono);
    if (telNorm) {
      const { data: contactos } = await db.from("contacto_operaciones").select("cliente_id, telefono, cliente_operaciones(razon_social)");
      const contacto = (contactos || []).find((c) => normalizarTelefono(c.telefono) === telNorm);
      if (contacto) { clienteId = contacto.cliente_id; razonSocial = contacto.cliente_operaciones?.razon_social; }
    }
  }

  // Si el arrendatario no sabe su RUT, puede escribir el nombre de la
  // empresa -- solo se acepta si matchea con UNA sola empresa (si hay
  // varias parecidas, es mas seguro tratarlo como "no encontrado" que
  // adivinar y crear la OT bajo el cliente equivocado).
  // Minimo 2 caracteres (no 4): hay clientes reales con razon social corta
  // ("2R Spa", "A3D Chile S. A.") que con un umbral mas alto nunca
  // matcheaban aunque el arrendatario escribiera el nombre exacto. La
  // ambiguedad sigue cubierta por la regla de "un solo candidato" de abajo.
  if (!clienteId && nombre && normalizarNombre(nombre).length >= 2) {
    const target = normalizarNombre(nombre);
    const { data: clientes } = await db.from("cliente_operaciones").select("id, razon_social");
    const candidatos = (clientes || []).filter((c) => {
      const n = normalizarNombre(c.razon_social);
      return n && (n === target || n.includes(target) || target.includes(n));
    });
    if (candidatos.length === 1) {
      clienteId = candidatos[0].id;
      razonSocial = candidatos[0].razon_social;
    }
  }

  if (!clienteId) return null;

  // Sin filtro de vigencia a proposito: quien escribe al bot para reportar
  // una incidencia se asume arrendatario activo -- si la fecha de termino de
  // su contrato quedo desactualizada (ej. una renovacion automatica que no
  // se reflejo aqui), no tiene que bloquear la identificacion. Si de verdad
  // ya no es cliente, Operaciones lo vera al revisar la OT creada.
  const { data: unidades } = await db
    .from("contrato_unidad")
    .select("unidad_id, contrato_operaciones!inner(cliente_id)")
    .eq("contrato_operaciones.cliente_id", clienteId);

  const unidadIds = [...new Set((unidades || []).map((v) => v.unidad_id))];
  if (!unidadIds.length) return null;
  return { clienteId, razonSocial, unidadIds };
}

// Un mismo cliente puede tener varias unidades vigentes (ej. varias bodegas
// o locales) -- cuando el bot no puede elegir una sola, le ofrece este
// listado al arrendatario para que indique el lugar exacto de la incidencia.
async function obtenerEtiquetasUnidades(db, unidadIds) {
  const { data } = await db.from("unidad")
    .select("id, codigo, edificio(nombre, sitio(codigo))")
    .in("id", unidadIds);
  return (data || []).map((u) => ({
    id: u.id,
    label: [u.edificio?.sitio?.codigo, u.edificio?.nombre || u.codigo].filter(Boolean).join(" — "),
  }));
}

// Para que Andres pueda asignar responsable escribiendo un nombre por
// WhatsApp (en vez de entrar a OCFast): busca en orden usuarios de OCFast
// (@patagonica.cl), luego personal de campo (sin cuenta de login, tabla
// "personal" -- mantencion, aseo, etc.) y por ultimo el catalogo de
// proveedores. Solo acepta un match si es unico, igual que el matcheo de
// clientes del bot.
async function resolverEjecutorPorNombre(db, nombre) {
  const target = normalizarNombre(nombre);
  if (target.length < 2) return null;

  const { data: usuarios } = await db.from("usuarios")
    .select("id, nombre, apellido").eq("activo", true).ilike("usuario", "%@patagonica.cl").not("rol_operaciones", "is", null);
  const candidatosUsuarios = (usuarios || []).filter((u) => {
    const n = normalizarNombre((u.nombre || "") + " " + (u.apellido || ""));
    return n && (n === target || n.includes(target) || target.includes(n));
  });
  if (candidatosUsuarios.length === 1) {
    const u = candidatosUsuarios[0];
    return { tipo: "interno", usuarioId: u.id, nombreMostrar: (u.nombre + " " + u.apellido).trim() };
  }

  const { data: personal } = await db.from("personal").select("id, nombre, apellido").eq("activo", true);
  const candidatosPersonal = (personal || []).filter((p) => {
    const n = normalizarNombre((p.nombre || "") + " " + (p.apellido || ""));
    return n && (n === target || n.includes(target) || target.includes(n));
  });
  if (candidatosPersonal.length === 1) {
    const p = candidatosPersonal[0];
    return { tipo: "personal", personalId: p.id, nombreMostrar: (p.nombre + " " + (p.apellido || "")).trim() };
  }

  const { data: proveedores } = await db.from("proveedores").select("id, razon_social").neq("activo", false);
  const candidatosProveedores = (proveedores || []).filter((p) => {
    const n = normalizarNombre(p.razon_social);
    return n && (n === target || n.includes(target) || target.includes(n));
  });
  if (candidatosProveedores.length === 1) {
    const p = candidatosProveedores[0];
    return { tipo: "proveedor", proveedorId: p.id, nombreMostrar: p.razon_social };
  }

  return null;
}

export default async function handler(req, res) {
  const db = supabase();

  // Asignar responsable/ejecutor a una OT escribiendole al bot por WhatsApp.
  // Solo el codigo ("OT0020"): Andres se autoasigna la OT. Codigo + nombre
  // ("OT0020 Juan Perez"): asigna a ese interno o proveedor. Mismo token fijo
  // que el resto del portal, sin sesion de OCFast.
  if (req.method === "POST" && req.query.andres_asignar) {
    const token = req.headers["x-portal-token"];
    if (!token || token !== process.env.PORTAL_CLIENTE_TOKEN) {
      return res.status(401).json({ error: "No autorizado" });
    }
    const body = await readJsonBody(req);
    if (!body.codigo) return res.status(400).json({ error: "codigo es obligatorio" });

    const { data: ot } = await db.from("ot_mantencion").select("id, codigo").ilike("codigo", body.codigo.trim()).eq("activo", true).maybeSingle();
    if (!ot) return res.status(404).json({ error: "ot_no_encontrada" });

    let fields, nombreMostrar, tipo;
    if (vacioANull(body.nombre)) {
      const match = await resolverEjecutorPorNombre(db, body.nombre);
      if (!match) return res.status(404).json({ error: "nombre_no_encontrado" });
      if (match.tipo === "interno") fields = { responsable_id: match.usuarioId };
      else if (match.tipo === "personal") fields = { personal_id: match.personalId };
      else fields = { ejecutor_tipo: "proveedor", ejecutor_proveedor_id: match.proveedorId };
      nombreMostrar = match.nombreMostrar;
      tipo = match.tipo;
    } else {
      fields = { responsable_id: await responsableDefecto(db) };
      nombreMostrar = "Andrés Sánchez";
      tipo = "interno";
    }
    const { error } = await db.from("ot_mantencion").update(fields).eq("id", ot.id);
    if (error) return res.status(500).json({ error: error.message });
    await registrarBitacora(db, ot.id, "Asignado desde WhatsApp a " + nombreMostrar + (tipo === "proveedor" ? " (proveedor)" : ""), "Andrés Sánchez");
    return res.status(200).json({ ok: true, codigo: ot.codigo, tipo, nombre: nombreMostrar });
  }

  // Resumen de una OT para el menu de Andres por WhatsApp (cliente,
  // descripcion y el telefono de quien reporto, si vino del bot -- para
  // poder llamarlo directo sin buscarlo en el catastro).
  if (req.method === "POST" && req.query.andres_ver_ot) {
    const token = req.headers["x-portal-token"];
    if (!token || token !== process.env.PORTAL_CLIENTE_TOKEN) {
      return res.status(401).json({ error: "No autorizado" });
    }
    const body = await readJsonBody(req);
    if (!body.codigo) return res.status(400).json({ error: "codigo es obligatorio" });

    const { data: ot } = await db.from("ot_mantencion")
      .select("codigo, titulo, descripcion_original, prioridad, estado, reportado_telefono, reportado_por, clientes_afectados")
      .ilike("codigo", body.codigo.trim()).eq("activo", true).maybeSingle();
    if (!ot) return res.status(404).json({ error: "ot_no_encontrada" });

    let cliente = ot.reportado_por;
    if (ot.clientes_afectados && ot.clientes_afectados[0]) {
      const { data: c } = await db.from("cliente_operaciones").select("razon_social").eq("id", ot.clientes_afectados[0]).maybeSingle();
      if (c) cliente = c.razon_social;
    }
    return res.status(200).json({
      ok: true, codigo: ot.codigo, titulo: ot.titulo, descripcion: ot.descripcion_original,
      prioridad: ot.prioridad, estado: ot.estado, cliente, telefono: ot.reportado_telefono,
    });
  }

  // Portal publico de solicitudes para arrendatarios (piloto, sin login) --
  // llamado por un canal externo (ej. un bot de Telegram/WhatsApp via n8n),
  // no por un usuario de OCFast, asi que se autentica con un token fijo en
  // vez del cookie de sesion. Va ANTES del gate @patagonica.cl de mas abajo.

  // Paso previo del bot: identificar al cliente por RUT o telefono para
  // poder saludarlo por nombre ("Hola Neva") antes de pedirle el detalle de
  // la incidencia -- no crea nada todavia.
  if (req.method === "POST" && req.query.identificar) {
    const token = req.headers["x-portal-token"];
    if (!token || token !== process.env.PORTAL_CLIENTE_TOKEN) {
      return res.status(401).json({ error: "No autorizado" });
    }
    const body = await readJsonBody(req);
    if (!body.rut && !body.telefono && !body.nombre) return res.status(400).json({ error: "rut, telefono o nombre es obligatorio" });
    const match = await resolverUnidadPorIdentificador(db, { rut: body.rut, telefono: body.telefono, nombre: body.nombre }, new Date().toISOString());
    if (!match) return res.status(404).json({ error: "no_encontrado" });
    if (match.unidadIds.length > 1) {
      const unidades = await obtenerEtiquetasUnidades(db, match.unidadIds);
      return res.status(200).json({ ok: true, razon_social: match.razonSocial, unidades });
    }
    return res.status(200).json({ ok: true, razon_social: match.razonSocial, unidad_id: match.unidadIds[0] });
  }

  if (req.method === "POST" && req.query.solicitud) {
    const token = req.headers["x-portal-token"];
    if (!token || token !== process.env.PORTAL_CLIENTE_TOKEN) {
      return res.status(401).json({ error: "No autorizado" });
    }
    const body = await readJsonBody(req);
    if (!body.rut && !body.telefono && !body.nombre) return res.status(400).json({ error: "rut, telefono o nombre es obligatorio" });
    if (!body.titulo) return res.status(400).json({ error: "titulo es obligatorio" });

    const fechaReporte = new Date().toISOString();
    const match = await resolverUnidadPorIdentificador(db, { rut: body.rut, telefono: body.telefono, nombre: body.nombre }, fechaReporte);
    if (!match) return res.status(404).json({ error: "rut_no_encontrado" });

    // Si el cliente tiene mas de una unidad vigente, el bot ya le pidio
    // elegir el sitio exacto (ver ?identificar=1) -- unidad_id viene con esa
    // eleccion. Se valida que de verdad sea una de las del cliente antes de
    // usarla, para que no se pueda crear una OT en una unidad ajena.
    let unidadId = match.unidadIds[0];
    if (body.unidad_id) {
      if (!match.unidadIds.includes(body.unidad_id)) {
        return res.status(400).json({ error: "unidad_id no corresponde a este cliente" });
      }
      unidadId = body.unidad_id;
    }

    const { data: unidad, error: eUnidad } = await db.from("unidad").select("id, sitio(empresa_id)").eq("id", unidadId).maybeSingle();
    const empresaId = unidad && unidad.sitio && unidad.sitio.empresa_id;
    if (eUnidad || !empresaId) return res.status(500).json({ error: eUnidad ? eUnidad.message : "No se pudo determinar la empresa de la unidad" });

    const categoriaInterna = CATEGORIA_BOT_A_INTERNA[body.categoria] || body.categoria;
    const impacto = CATEGORIA_IMPACTO[categoriaInterna] || CATEGORIA_IMPACTO_DEFAULT;
    const urgencia = "Estable";
    const prioridad = calcularPrioridad(impacto, urgencia);
    let { clienteIds, contratoIds } = await resolverClientesContratos(db, "unidad", unidad.id, fechaReporte);
    if (!clienteIds.includes(match.clienteId)) {
      // resolverClientesContratos SI filtra por vigencia (la usan tambien
      // flujos internos donde "vacante" importa) -- si por eso no incluyo al
      // cliente que el bot ya identifico explicitamente, lo agrego igual en
      // vez de dejar la OT sin cliente/contrato asociado.
      const { data: contratosCliente } = await db.from("contrato_unidad")
        .select("contrato_id, contrato_operaciones!inner(cliente_id)")
        .eq("unidad_id", unidad.id).eq("contrato_operaciones.cliente_id", match.clienteId);
      clienteIds = [...new Set([...clienteIds, match.clienteId])];
      contratoIds = [...new Set([...contratoIds, ...(contratosCliente || []).map((c) => c.contrato_id)])];
    }
    const fechas = await calcularFechasLimite(db, prioridad, fechaReporte, contratoIds);
    const cat = CATEGORIAS[categoriaInterna];
    const { data: numero, error: eNum } = await db.rpc("siguiente_numero_ot");
    if (eNum) return res.status(500).json({ error: eNum.message });

    const { data, error } = await db.from("ot_mantencion").insert({
      codigo: "OT-" + String(numero).padStart(4, "0"),
      empresa_id: empresaId, titulo: body.titulo, resumen: body.titulo,
      categoria: vacioANull(body.categoria),
      ubicacion_tipo: "unidad", ubicacion_id: unidad.id,
      clientes_afectados: clienteIds, contratos_afectados: contratoIds,
      impacto, urgencia, prioridad,
      estado: "Nueva",
      responsable_id: await responsableDefecto(db),
      cargo: cat ? cat.cargo : "Por definir",
      ...fechas,
      reportado_por: vacioANull(body.reportado_por), fecha_reporte: fechaReporte,
      descripcion_original: vacioANull(body.descripcion) || body.titulo,
      reportado_telefono: vacioANull(body.telefono_reportante),
      creado_por_usuario: "amelendez@patagonica.cl",
      origen: "portal_cliente",
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    await registrarBitacora(db, data.id, vacioANull(body.descripcion) || data.resumen || data.titulo, body.reportado_por || "Arrendatario (portal)");
    if (match.unidadIds.length > 1 && body.unidad_id) {
      await registrarBitacora(db, data.id, "Cliente tiene " + match.unidadIds.length + " unidades vigentes -- el arrendatario seleccionó la ubicación directamente", "sistema");
    } else if (match.unidadIds.length > 1) {
      await registrarBitacora(db, data.id, "Cliente tiene " + match.unidadIds.length + " unidades vigentes -- confirmar cuál corresponde con el contacto", "sistema");
    }
    // Foto(s) de la incidencia enviadas por el bot (Telegram/WhatsApp) -- ya
    // subidas a Storage antes de llegar aqui, solo falta dejarlas asociadas
    // a la OT igual que la evidencia que sube el personal interno.
    if (Array.isArray(body.adjuntos)) {
      for (const a of body.adjuntos) {
        if (a && a.url) {
          // ot_evidencia.tipo tiene un check: solo acepta 'antes'/'durante'/
          // 'despues'/'documento'/'factura' -- "foto" no es valido ahi (esto
          // hacia fallar el insert en silencio, sin que nadie se enterara).
          const { error: eEvidencia } = await db.from("ot_evidencia").insert({
            ot_id: data.id, archivo_url: a.url, archivo_nombre: vacioANull(a.nombre),
            tipo: "antes", autor_usuario: body.reportado_por || "Arrendatario (portal)",
          });
          if (eEvidencia) {
            await registrarBitacora(db, data.id, "No se pudo guardar un adjunto enviado por el bot: " + eEvidencia.message, "sistema");
          }
        }
      }
    }
    return res.status(201).json({ ok: true, codigo: data.codigo, prioridad: data.prioridad });
  }

  const session = verifyToken(parseCookie(req.headers.cookie, "ocsys_token"), process.env.SESSION_SECRET || "");
  if (!session || !(session.usuario || "").toLowerCase().endsWith("@patagonica.cl")) {
    return res.status(403).json({ error: "Esta función es solo para personal de Patagónica" });
  }
  const usuario = session.usuario;

  try {
    if (req.method === "GET") {
      if (req.query.categorias) return res.status(200).json({ categorias: CATEGORIAS });

      if (req.query.usuarios) {
        // Solo personal a cargo de Operaciones (rol_operaciones asignado) --
        // no todo el que tiene cuenta @patagonica.cl en OCFast (ej. gente de
        // Finanzas que solo genera OC no deberia aparecer como responsable
        // posible de una OT de mantencion).
        const { data, error } = await db.from("usuarios").select("id, usuario, nombre, apellido, rol_operaciones, especialidad")
          .eq("activo", true).ilike("usuario", "%@patagonica.cl").not("rol_operaciones", "is", null).order("nombre");
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ usuarios: data });
      }

      // Personal de campo (mantencion, aseo, etc.) sin cuenta de login en
      // OCFast -- se asigna igual que un responsable, pero vive en su propia
      // tabla porque no corresponde crearles un usuario.
      if (req.query.personal) {
        const { data, error } = await db.from("personal").select("id, nombre, apellido, rol")
          .eq("activo", true).order("nombre");
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ personal: data });
      }

      if (req.query.catalogo) {
        const empresaId = Number(req.query.empresa_id) || 1;
        const [sitios, edificios, unidades, areasComunes, clientes, contratos, contactos] = await Promise.all([
          db.from("sitio").select("*").eq("empresa_id", empresaId).eq("activo", true).order("codigo"),
          db.from("edificio").select("*, sitio!inner(empresa_id)").eq("sitio.empresa_id", empresaId).eq("activo", true).order("codigo"),
          db.from("unidad").select("*, edificio!inner(sitio!inner(empresa_id))").eq("edificio.sitio.empresa_id", empresaId).order("codigo"),
          db.from("area_comun").select("*").order("codigo"),
          db.from("cliente_operaciones").select("*").order("razon_social"),
          db.from("contrato_operaciones").select("*, cliente_operaciones(razon_social), contrato_unidad(unidad_id, desde, hasta)").order("codigo"),
          db.from("contacto_operaciones").select("*, cliente_operaciones(razon_social)").order("nombre"),
        ]);
        for (const r of [sitios, edificios, unidades, areasComunes, clientes, contratos, contactos]) {
          if (r.error) return res.status(500).json({ error: r.error.message });
        }
        return res.status(200).json({
          sitios: sitios.data, edificios: edificios.data, unidades: unidades.data,
          areas_comunes: areasComunes.data, clientes: clientes.data, contratos: contratos.data,
          contactos: contactos.data,
        });
      }

      if (req.query.id) {
        const { data: ot, error } = await db.from("ot_mantencion")
          .select("*, usuarios!ot_mantencion_responsable_id_fkey(nombre, apellido), personal(nombre, apellido, rol), proveedores(razon_social, rut)")
          .eq("id", req.query.id).eq("activo", true).maybeSingle();
        if (error) return res.status(500).json({ error: error.message });
        if (!ot) return res.status(404).json({ error: "OT no encontrada" });
        const [{ data: bitacora }, { data: tareas }, { data: evidencias }, { data: costos }] = await Promise.all([
          db.from("ot_bitacora").select("*").eq("ot_id", ot.id).order("created_at", { ascending: true }),
          db.from("ot_tarea").select("*").eq("ot_id", ot.id).order("created_at", { ascending: true }),
          db.from("ot_evidencia").select("*").eq("ot_id", ot.id).order("created_at", { ascending: true }),
          db.from("ot_costo").select("*, proveedores(razon_social)").eq("ot_id", ot.id).order("fecha", { ascending: true }),
        ]);
        const { ufHoy } = await valoresUF(db, []);
        return res.status(200).json({ ot, bitacora, tareas, evidencias, costos, uf_hoy: ufHoy });
      }

      // Mesa de control: lista de OT activas de la empresa.
      const empresaId = Number(req.query.empresa_id) || 1;
      const { data: ots, error } = await db.from("ot_mantencion")
        .select("*, usuarios!ot_mantencion_responsable_id_fkey(nombre, apellido), personal(nombre, apellido, rol), proveedores(razon_social, rut)")
        .eq("empresa_id", empresaId).eq("activo", true)
        .order("created_at", { ascending: false });
      if (error) return res.status(500).json({ error: error.message });

      const otIds = (ots || []).map((o) => o.id);
      const { data: bitacoras } = otIds.length
        ? await db.from("ot_bitacora").select("*").in("ot_id", otIds).order("created_at", { ascending: true })
        : { data: [] };
      const porOt = {};
      for (const b of bitacoras || []) (porOt[b.ot_id] = porOt[b.ot_id] || []).push(b);
      const lista = (ots || []).map((o) => ({ ...o, bitacora: porOt[o.id] || [] }));
      return res.status(200).json({ ots: lista });
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);

      // ---- Catálogo ----
      if (req.query.sitio) {
        if (!body.empresa_id || !body.codigo || !body.nombre) return res.status(400).json({ error: "empresa_id, codigo y nombre son obligatorios" });
        const { data, error } = await db.from("sitio").insert({
          empresa_id: body.empresa_id, codigo: body.codigo, nombre: body.nombre,
          direccion: vacioANull(body.direccion), rol_sii: vacioANull(body.rol_sii),
          superficie_terreno_m2: vacioANull(body.superficie_terreno_m2),
        }).select().single();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(201).json({ sitio: data });
      }
      if (req.query.edificio) {
        if (!body.sitio_id || !body.codigo || !body.nombre) return res.status(400).json({ error: "sitio_id, codigo y nombre son obligatorios" });
        const { data, error } = await db.from("edificio").insert({
          sitio_id: body.sitio_id, codigo: body.codigo, nombre: body.nombre,
          direccion: vacioANull(body.direccion), pisos: vacioANull(body.pisos),
          alias: Array.isArray(body.alias) ? body.alias : [],
        }).select().single();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(201).json({ edificio: data });
      }
      if (req.query.unidad) {
        if (!body.sitio_id || !body.edificio_id || !body.codigo) return res.status(400).json({ error: "sitio_id, edificio_id y codigo son obligatorios" });
        const { data, error } = await db.from("unidad").insert({
          sitio_id: body.sitio_id, edificio_id: body.edificio_id, codigo: body.codigo,
          nombre: vacioANull(body.nombre), tipo: vacioANull(body.tipo), piso: vacioANull(body.piso),
          superficie_m2: vacioANull(body.superficie_m2), estado: body.estado || "Ocupada",
          alias: Array.isArray(body.alias) ? body.alias : [],
        }).select().single();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(201).json({ unidad: data });
      }
      if (req.query.area_comun) {
        if (!body.codigo || !body.nombre) return res.status(400).json({ error: "codigo y nombre son obligatorios" });
        const { data, error } = await db.from("area_comun").insert({
          sitio_id: vacioANull(body.sitio_id), edificio_id: vacioANull(body.edificio_id),
          codigo: body.codigo, nombre: body.nombre,
          unidades_que_atiende: Array.isArray(body.unidades_que_atiende) ? body.unidades_que_atiende : [],
          alias: Array.isArray(body.alias) ? body.alias : [],
        }).select().single();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(201).json({ area_comun: data });
      }
      if (req.query.cliente) {
        if (!body.rut || !body.razon_social) return res.status(400).json({ error: "rut y razón social son obligatorios" });
        const { data, error } = await db.from("cliente_operaciones").insert({
          rut: body.rut, razon_social: body.razon_social, nombre_fantasia: vacioANull(body.nombre_fantasia),
          giro: vacioANull(body.giro), dominios_correo: Array.isArray(body.dominios_correo) ? body.dominios_correo : [],
          estado: body.estado || "Activo", notas: vacioANull(body.notas),
        }).select().single();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(201).json({ cliente: data });
      }
      if (req.query.contacto) {
        if (!body.cliente_id || !body.nombre) return res.status(400).json({ error: "cliente_id y nombre son obligatorios" });
        const { data, error } = await db.from("contacto_operaciones").insert({
          cliente_id: body.cliente_id, nombre: body.nombre, cargo: vacioANull(body.cargo),
          correo: vacioANull(body.correo), telefono: vacioANull(body.telefono),
          rol: Array.isArray(body.rol) ? body.rol : [], principal_operaciones: !!body.principal_operaciones,
        }).select().single();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(201).json({ contacto: data });
      }
      if (req.query.contrato) {
        if (!body.codigo || !body.cliente_id || !body.fecha_inicio || !Array.isArray(body.unidad_ids) || !body.unidad_ids.length) {
          return res.status(400).json({ error: "codigo, cliente_id, fecha_inicio y al menos una unidad son obligatorios" });
        }
        const { data: contrato, error } = await db.from("contrato_operaciones").insert({
          codigo: body.codigo, cliente_id: body.cliente_id, fecha_inicio: body.fecha_inicio,
          fecha_termino: vacioANull(body.fecha_termino), renta_uf: vacioANull(body.renta_uf),
          gastos_comunes_uf: vacioANull(body.gastos_comunes_uf), garantia_tipo: vacioANull(body.garantia_tipo),
          garantia_monto: vacioANull(body.garantia_monto), garantia_vencimiento: vacioANull(body.garantia_vencimiento),
          seguro_arrendatario_vencimiento: vacioANull(body.seguro_arrendatario_vencimiento),
          clausula_mantencion: vacioANull(body.clausula_mantencion),
          sla_respuesta_horas: vacioANull(body.sla_respuesta_horas), sla_solucion_dias: vacioANull(body.sla_solucion_dias),
          horario_acceso: vacioANull(body.horario_acceso), uso_compartido: !!body.uso_compartido,
        }).select().single();
        if (error) return res.status(500).json({ error: error.message });
        const filas = body.unidad_ids.map((uid) => ({ contrato_id: contrato.id, unidad_id: uid, desde: body.fecha_inicio, hasta: vacioANull(body.fecha_termino) }));
        const { error: e2 } = await db.from("contrato_unidad").insert(filas);
        if (e2) return res.status(500).json({ error: e2.message });
        return res.status(201).json({ contrato });
      }

      // ---- Sub-entidades de una OT ----
      if (req.query.bitacora) {
        const texto = (body.texto || "").trim();
        if (!texto || !body.ot_id) return res.status(400).json({ error: "ot_id y texto son obligatorios" });
        const { data, error } = await db.from("ot_bitacora").insert({ ot_id: body.ot_id, tipo: "comentario", texto, usuario }).select().single();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(201).json({ entrada: data });
      }
      if (req.query.tarea) {
        if (!body.ot_id || !body.descripcion) return res.status(400).json({ error: "ot_id y descripción son obligatorios" });
        const { data, error } = await db.from("ot_tarea").insert({
          ot_id: body.ot_id, descripcion: body.descripcion, responsable_id: vacioANull(body.responsable_id), fecha: vacioANull(body.fecha),
        }).select().single();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(201).json({ tarea: data });
      }
      if (req.query.evidencia) {
        if (!body.ot_id || !body.archivo_url) return res.status(400).json({ error: "ot_id y archivo_url son obligatorios" });
        const { data, error } = await db.from("ot_evidencia").insert({
          ot_id: body.ot_id, archivo_url: body.archivo_url, archivo_nombre: vacioANull(body.archivo_nombre),
          tipo: body.tipo || "documento", autor_usuario: usuario,
        }).select().single();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(201).json({ evidencia: data });
      }
      if (req.query.costo) {
        if (!body.ot_id || !body.monto_clp) return res.status(400).json({ error: "ot_id y monto_clp son obligatorios" });
        const { data, error } = await db.from("ot_costo").insert({
          ot_id: body.ot_id, concepto: body.concepto || "otro", monto_clp: body.monto_clp,
          descripcion: vacioANull(body.descripcion),
          proveedor_id: vacioANull(body.proveedor_id), numero_factura_boleta: vacioANull(body.numero_factura_boleta),
          fecha: body.fecha || new Date().toISOString().slice(0, 10),
        }).select().single();
        if (error) return res.status(500).json({ error: error.message });
        await registrarBitacora(db, body.ot_id, "Costo registrado: $" + Number(body.monto_clp).toLocaleString("es-CL") + " (" + (body.concepto || "otro") + ")" + (body.descripcion ? " — " + body.descripcion : ""), usuario);
        return res.status(201).json({ costo: data });
      }

      // ---- Registro rápido: nueva OT ----
      const empresaId = Number(body.empresa_id);
      if (!empresaId) return res.status(400).json({ error: "empresa_id es obligatorio" });
      if (!body.titulo) return res.status(400).json({ error: "El título (qué pasa) es obligatorio" });
      if (!body.ubicacion_tipo || !body.ubicacion_id) return res.status(400).json({ error: "La ubicación es obligatoria" });

      // El Registro rápido ya no pide Impacto/Urgencia -- la prioridad inicial
      // se infiere de la categoría con un supuesto conservador (no urgente) y
      // se termina de ajustar despues a mano (P1-P4) desde la ficha de la OT.
      const impacto = body.impacto || CATEGORIA_IMPACTO[body.categoria] || CATEGORIA_IMPACTO_DEFAULT;
      const urgencia = body.urgencia || "Estable";
      const prioridad = calcularPrioridad(impacto, urgencia);
      if (!prioridad) return res.status(400).json({ error: "Combinación de impacto/urgencia no válida" });
      const fechaReporte = body.fecha_reporte || new Date().toISOString();
      const { clienteIds, contratoIds, vacante } = await resolverClientesContratos(db, body.ubicacion_tipo, body.ubicacion_id, fechaReporte);
      const fechas = await calcularFechasLimite(db, prioridad, fechaReporte, contratoIds);
      const cat = CATEGORIAS[body.categoria];
      const { data: numero, error: eNum } = await db.rpc("siguiente_numero_ot");
      if (eNum) return res.status(500).json({ error: eNum.message });

      const { data, error } = await db.from("ot_mantencion").insert({
        codigo: "OT-" + String(numero).padStart(4, "0"),
        empresa_id: empresaId, titulo: body.titulo, resumen: vacioANull(body.resumen) || body.titulo,
        elemento_afectado: vacioANull(body.elemento_afectado),
        categoria: vacioANull(body.categoria), subcategoria: vacioANull(body.subcategoria),
        ubicacion_tipo: body.ubicacion_tipo, ubicacion_id: body.ubicacion_id,
        ubicaciones_adicionales: Array.isArray(body.ubicaciones_adicionales) ? body.ubicaciones_adicionales : [],
        clientes_afectados: clienteIds, contratos_afectados: contratoIds,
        impacto, urgencia, prioridad,
        estado: "Nueva", centro_costo_codigo: vacioANull(body.centro_costo_codigo),
        responsable_id: await responsableDefecto(db),
        cargo: vacante ? "Arrendador" : (cat ? cat.cargo : "Por definir"),
        ...fechas,
        reportado_por: vacioANull(body.reportado_por), fecha_reporte: fechaReporte,
        descripcion_original: vacioANull(body.descripcion_original),
        creado_por_usuario: usuario,
      }).select().single();
      if (error) return res.status(500).json({ error: error.message });
      await registrarBitacora(db, data.id, data.resumen || data.titulo, body.reportado_por || usuario, "sistema");
      if (vacante) await registrarBitacora(db, data.id, "Unidad vacante: sin cliente asociado", usuario, "sistema");
      return res.status(201).json({ ot: data });
    }

    if (req.method === "PUT") {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "id es obligatorio" });
      const { data: actual } = await db.from("ot_mantencion").select("*").eq("id", id).eq("activo", true).maybeSingle();
      if (!actual) return res.status(404).json({ error: "OT no encontrada" });
      const body = await readJsonBody(req);
      const fields = {};
      const cambios = [];

      if (body.estado !== undefined && body.estado !== actual.estado) {
        const ESTADOS = ["Nueva", "Asignada", "En curso", "En espera", "Resuelta", "Cerrada", "Anulada"];
        if (!ESTADOS.includes(body.estado)) return res.status(400).json({ error: "Estado no válido" });
        // Mismo mapa que OT_TRANSICIONES en index.html -- se valida tambien
        // aqui (no solo ocultando opciones en el selector del frontend) para
        // que nada se salte "En curso" y fecha_inicio quede sin llenar.
        const TRANSICIONES_VALIDAS = {
          "Nueva": ["Asignada", "Anulada"],
          "Asignada": ["En curso", "En espera", "Anulada"],
          "En curso": ["En espera", "Resuelta", "Anulada"],
          "En espera": ["En curso", "Anulada"],
          "Resuelta": ["En curso", "Cerrada"],
          "Cerrada": ["En curso"],
          "Anulada": [],
        };
        if (!(TRANSICIONES_VALIDAS[actual.estado] || []).includes(body.estado)) {
          return res.status(400).json({ error: "No se puede pasar de \"" + actual.estado + "\" a \"" + body.estado + "\" directamente" });
        }
        if (body.estado === "Asignada" && !(body.responsable_id || actual.responsable_id)) {
          return res.status(400).json({ error: "No se puede asignar sin responsable" });
        }
        if (body.estado === "Resuelta" && !(body.solucion || actual.solucion)) {
          return res.status(400).json({ error: "La solución es obligatoria para resolver" });
        }
        if (body.estado === "Cerrada") {
          const costoReal = body.costo_real !== undefined ? body.costo_real : actual.costo_real;
          const cargo = body.cargo !== undefined ? body.cargo : actual.cargo;
          if (costoReal === null || costoReal === undefined) return res.status(400).json({ error: "El costo real es obligatorio para cerrar (puede ser 0)" });
          if (!cargo || cargo === "Por definir") return res.status(400).json({ error: "El cargo es obligatorio para cerrar" });
        }
        fields.estado = body.estado;
        if (body.estado === "Asignada" && !actual.fecha_asignacion) fields.fecha_asignacion = new Date().toISOString();
        if (body.estado === "En curso" && !actual.fecha_inicio) fields.fecha_inicio = new Date().toISOString();
        if (body.estado === "Resuelta") fields.fecha_resolucion = new Date().toISOString();
        if (body.estado === "Cerrada") fields.fecha_cierre = new Date().toISOString();
        if (body.estado === "En curso" && actual.estado === "Cerrada") fields.reaperturas = (actual.reaperturas || 0) + 1;
        if (body.motivo_espera !== undefined) fields.motivo_espera = vacioANull(body.motivo_espera);
        cambios.push(actual.estado + " → " + body.estado);
      }
      if (body.responsable_id !== undefined) { fields.responsable_id = vacioANull(body.responsable_id); }
      if (body.personal_id !== undefined) { fields.personal_id = vacioANull(body.personal_id); }
      if (body.ejecutor_tipo !== undefined) fields.ejecutor_tipo = vacioANull(body.ejecutor_tipo);
      if (body.ejecutor_proveedor_id !== undefined) fields.ejecutor_proveedor_id = vacioANull(body.ejecutor_proveedor_id);
      if (body.ejecutor_interno !== undefined) fields.ejecutor_interno = vacioANull(body.ejecutor_interno);
      // Si se asigna responsable/personal/proveedor mientras la OT sigue
      // "Nueva", pasa sola a "Asignada" -- no hace falta que elijan ese
      // estado aparte en el selector de "Cambiar estado a" (feedback del
      // usuario: ese paso es redundante y "Nueva" ya no ofrece esa opcion).
      if (body.estado === undefined && actual.estado === "Nueva"
        && (fields.responsable_id || fields.personal_id || fields.ejecutor_proveedor_id)) {
        fields.estado = "Asignada";
        fields.fecha_asignacion = new Date().toISOString();
      }
      if (body.contencion_realizada === true && !actual.contencion_realizada) {
        fields.contencion_realizada = new Date().toISOString();
        cambios.push("Contención realizada");
      }
      if (body.solucion !== undefined) fields.solucion = vacioANull(body.solucion);
      if (body.costo_real !== undefined) fields.costo_real = vacioANull(body.costo_real);
      if (body.costo_estimado !== undefined) {
        fields.costo_estimado = vacioANull(body.costo_estimado);
        if (fields.costo_estimado) {
          const requiere = await requiereAprobacionGasto(db, actual.empresa_id, actual.centro_costo_codigo, Number(fields.costo_estimado));
          if (requiere && !actual.aprobacion_gasto_fecha) {
            fields.estado = fields.estado || "En espera";
            fields.motivo_espera = "Aprobación de gasto";
            cambios.push("Requiere aprobación de gasto (supera presupuesto/umbral)");
          }
        }
      }
      if (body.cargo !== undefined) fields.cargo = vacioANull(body.cargo);
      if (body.cargo_compartido_pct !== undefined) fields.cargo_compartido_pct = vacioANull(body.cargo_compartido_pct);
      if (body.recuperable_monto !== undefined) fields.recuperable_monto = vacioANull(body.recuperable_monto);
      if (body.prioridad !== undefined && body.prioridad !== actual.prioridad) {
        if (!body.prioridad_motivo_cambio) return res.status(400).json({ error: "El cambio de prioridad requiere un motivo" });
        fields.prioridad = body.prioridad;
        fields.prioridad_motivo_cambio = body.prioridad_motivo_cambio;
        cambios.push("Prioridad " + actual.prioridad + " → " + body.prioridad + " (" + body.prioridad_motivo_cambio + ")");
      }
      if (body.aprobar_gasto === true) {
        fields.aprobacion_gasto_usuario = usuario;
        fields.aprobacion_gasto_fecha = new Date().toISOString();
        if (actual.motivo_espera === "Aprobación de gasto") { fields.estado = "En curso"; fields.motivo_espera = null; }
        cambios.push("Gasto aprobado por " + usuario);
      }

      // Si se asigna una empresa ejecutora y la OT todavia no tiene a nadie de
      // Patagonica a cargo (ni responsable ni personal), Andres queda como
      // responsable por defecto -- sigue siendo el punto de contacto interno
      // aunque la ejecucion quede externa.
      if (fields.ejecutor_proveedor_id && !actual.responsable_id && !actual.personal_id
        && fields.responsable_id === undefined && fields.personal_id === undefined) {
        fields.responsable_id = await responsableDefecto(db);
      }

      if (!Object.keys(fields).length) return res.status(400).json({ error: "No hay campos para actualizar" });
      const { data, error } = await db.from("ot_mantencion").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id).select().single();
      if (error) return res.status(500).json({ error: error.message });
      for (const c of cambios) await registrarBitacora(db, id, c, usuario, "sistema");
      return res.status(200).json({ ot: data });
    }

    res.setHeader("Allow", "GET, POST, PUT");
    return res.status(405).json({ error: "Método no permitido" });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Error de servidor" });
  }
}
