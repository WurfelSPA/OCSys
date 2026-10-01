import { supabase, readJsonBody } from "./_supabase.js";
import { calcularFilasCuotas } from "./_cuotas.js";
import { verifyToken, parseCookie } from "./_session.js";
import { enviarCorreoAprobacion, enviarCorreoFactura, enviarCorreoPago } from "./_email.js";

// Aprobada -> se asigna HES y se envia la OC al proveedor.
// Facturada -> se subio la factura del proveedor; se avisa al equipo de pagos.
// Completada -> se subio el comprobante de pago, cierra el ciclo.
const ESTADOS_OCSYS = ["Borrador", "Pendiente aprobación", "Aprobada", "Facturada", "Completada"];

// Convierte la fila actual (Borrador) en la cuota 1, e inserta las cuotas
// 2..N como filas nuevas -- todas comparten los mismos datos de "creacion"
// de la OC (proveedor, titulo, etc.) pero cada una con su propio numero_oc
// (sufijo), monto y ciclo de aprobacion/factura/pago independiente. Ver
// docs/superpowers/specs/2026-09-29-ordenes-en-cuotas-design.md
async function dividirEnCuotasPUT(db, id, body, res) {
  const { data: actual, error: actualError } = await db.from("ordenes_compra").select("*").eq("id", id).maybeSingle();
  if (actualError) return res.status(500).json({ error: actualError.message });
  if (!actual) return res.status(404).json({ error: "OC no encontrada" });
  if (!["Borrador", "Pendiente aprobación"].includes(actual.estado)) {
    return res.status(403).json({ error: "La OC ya fue aprobada y no se puede editar" });
  }

  const filasCuotas = calcularFilasCuotas({
    cuotas: body.cuotas,
    montoNeto: body.monto_neto !== undefined ? body.monto_neto : actual.monto_neto,
    montoIva: body.monto_iva !== undefined ? body.monto_iva : actual.monto_iva,
    numeroBase: actual.numero_oc,
  });

  const campo = (clave, transform) => {
    if (body[clave] === undefined) return actual[clave];
    return transform ? transform(body[clave]) : body[clave];
  };
  const camposComunes = {
    numero_cotizacion: campo("numero_cotizacion"),
    proyecto_id: campo("proyecto_id", (v) => v || null),
    titulo: campo("titulo"),
    descripcion: campo("descripcion"),
    condiciones: campo("condiciones"),
    motivo: campo("motivo"),
    proveedor_id: campo("proveedor_id"),
    centro_costo_codigo: campo("centro_costo_codigo", (v) => v || null),
    cuenta_contable_codigo: campo("cuenta_contable_codigo", (v) => v || null),
    tipo_orden: campo("tipo_orden"),
    tipo_compra: campo("tipo_compra"),
    moneda: campo("moneda"),
    fecha: campo("fecha"),
    archivo_url: campo("archivo_url"),
    archivo_nombre: campo("archivo_nombre"),
    creado_por: campo("creado_por"),
    empresa_id: actual.empresa_id,
    creado_por_usuario: actual.creado_por_usuario,
    gerencia: actual.gerencia,
    estado: "Pendiente aprobación",
    cuotas: [],
  };

  const selectCompleto = "*, proveedores(razon_social, rut, contacto_correo, banco, tipo_cuenta, numero_cuenta), empresas(correo_contabilidad), proyectos(nombre)";
  const [primera, ...resto] = filasCuotas;

  const { data: filaActualizada, error: updateError } = await db
    .from("ordenes_compra")
    .update({ ...camposComunes, ...primera, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(selectCompleto)
    .single();
  if (updateError) return res.status(500).json({ error: updateError.message });

  let filasNuevas = [];
  if (resto.length) {
    const { data: insertadas, error: insertError } = await db
      .from("ordenes_compra")
      .insert(resto.map((f) => ({ ...camposComunes, ...f })))
      .select(selectCompleto);
    if (insertError) return res.status(500).json({ error: insertError.message });
    filasNuevas = insertadas;
  }

  return res.status(200).json({ ordenes: [filaActualizada, ...filasNuevas] });
}

export default async function handler(req, res) {
  const db = supabase();

  if (req.method === "PUT") {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "id es obligatorio" });
    const body = await readJsonBody(req);

    if (body.estado === "Pendiente aprobación" && Array.isArray(body.cuotas) && body.cuotas.length > 1) {
      return dividirEnCuotasPUT(db, id, body, res);
    }

    // Estos son los datos "de creacion" de la OC (los mismos que se cargan en
    // Nueva OC) -- una vez que la orden entra a Aprobada (o mas alla), quedan
    // congelados: ya se envio el HES/PDF al proveedor con esos datos, asi que
    // corregirlos ahi generaria una OC inconsistente con lo ya enviado.
    const CAMPOS_SOLO_ANTES_DE_APROBAR = [
      "proveedor_id", "numero_cotizacion", "proyecto_id", "titulo", "descripcion", "condiciones", "motivo",
      "creado_por", "centro_costo_codigo", "cuenta_contable_codigo", "tipo_orden", "tipo_compra",
      "moneda", "monto_neto", "monto_iva", "monto_total", "fecha", "cuotas",
    ];
    if (CAMPOS_SOLO_ANTES_DE_APROBAR.some((k) => body[k] !== undefined)) {
      const { data: actual } = await db.from("ordenes_compra").select("estado").eq("id", id).maybeSingle();
      if (actual && !["Borrador", "Pendiente aprobación"].includes(actual.estado)) {
        return res.status(403).json({ error: "La OC ya fue aprobada y no se puede editar" });
      }
    }

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
        // un segundo paso). Si no lo manda, se pide aqui el siguiente
        // correlativo real (ver Task 1 / siguiente_numero_hes).
        if (body.numero_hes) {
          fields.numero_hes = body.numero_hes;
        } else {
          const { data: filaActual } = await db.from("ordenes_compra").select("empresa_id").eq("id", id).maybeSingle();
          const { data: siguienteHes, error: hesError } = await db.rpc("siguiente_numero_hes", { p_empresa_id: filaActual?.empresa_id || 1 });
          if (hesError) return res.status(500).json({ error: hesError.message });
          fields.numero_hes = String(siguienteHes).padStart(8, "0");
        }
      }
      if (body.estado === "Pendiente aprobación") {
        // "Desaprobar": revertir una OC ya Aprobada de vuelta a Pendiente
        // aprobación, para poder corregirla y volver a aprobarla (mismo N°
        // de OC, mismo HES -- ninguno de los dos se toca aqui, solo cambia
        // el estado). Requiere el mismo nivel que se usa para aprobar. No se
        // permite si ya paso a Facturada/Completada (ahi solo cabe Anular).
        const { data: filaActual } = await db.from("ordenes_compra").select("estado").eq("id", id).maybeSingle();
        if (filaActual && filaActual.estado === "Aprobada") {
          session = verifyToken(parseCookie(req.headers.cookie, "ocsys_token"), process.env.SESSION_SECRET || "");
          if (!session || session.nivel_aprobacion !== 1) {
            return res.status(403).json({ error: "No tienes nivel de aprobación para desaprobar órdenes de compra" });
          }
        } else if (filaActual && !["Borrador", "Pendiente aprobación"].includes(filaActual.estado)) {
          return res.status(403).json({ error: "Esta OC ya no se puede devolver a Pendiente aprobación" });
        }
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
    if (body.monto_facturado_neto !== undefined) fields.monto_facturado_neto = body.monto_facturado_neto;
    if (body.monto_facturado_uf !== undefined) fields.monto_facturado_uf = body.monto_facturado_uf;
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
    if (body.numero_cotizacion !== undefined) fields.numero_cotizacion = body.numero_cotizacion;
    if (body.proyecto_id !== undefined) fields.proyecto_id = body.proyecto_id || null;
    if (body.titulo !== undefined) fields.titulo = body.titulo;
    if (body.descripcion !== undefined) fields.descripcion = body.descripcion;
    if (body.condiciones !== undefined) fields.condiciones = body.condiciones;
    if (body.motivo !== undefined) fields.motivo = body.motivo;
    if (body.proveedor_id !== undefined) fields.proveedor_id = body.proveedor_id;
    if (body.creado_por !== undefined) fields.creado_por = body.creado_por;
    if (body.centro_costo_codigo !== undefined) fields.centro_costo_codigo = body.centro_costo_codigo || null;
    if (body.cuenta_contable_codigo !== undefined) fields.cuenta_contable_codigo = body.cuenta_contable_codigo || null;
    if (body.tipo_orden !== undefined) fields.tipo_orden = body.tipo_orden;
    if (body.tipo_compra !== undefined) fields.tipo_compra = body.tipo_compra;
    if (body.moneda !== undefined) fields.moneda = body.moneda;
    if (body.monto_neto !== undefined) fields.monto_neto = body.monto_neto;
    if (body.monto_iva !== undefined) fields.monto_iva = body.monto_iva;
    if (body.monto_total !== undefined) fields.monto_total = body.monto_total;
    if (body.fecha !== undefined) fields.fecha = body.fecha;
    if (body.cuotas !== undefined) fields.cuotas = Array.isArray(body.cuotas) ? body.cuotas : [];

    if (Object.keys(fields).length === 0) {
      return res.status(400).json({ error: "No hay campos para actualizar" });
    }

    const { data, error } = await db
      .from("ordenes_compra")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*, proveedores(razon_social, rut, contacto_correo, banco, tipo_cuenta, numero_cuenta), empresas(correo_contabilidad), proyectos(nombre)")
      .single();
    if (error) return res.status(500).json({ error: error.message });

    // Copia (CC) al usuario de OCSys que elaboro la OC, para que le quede
    // registro sin importar quien haya disparado esta accion en particular
    // (aprobar/facturar/pagar puede ser otra persona). El "usuario" (login)
    // es directamente el correo corporativo, asi que no hace falta buscarlo
    // en ningun lado.
    const ccUsuario = data.creado_por_usuario || null;

    let correoError = null;
    if (body.estado === "Aprobada") {
      try {
        await enviarCorreoAprobacion(data, ccUsuario);
      } catch (e) {
        correoError = e.message;
      }
    }
    if (body.estado === "Facturada") {
      try {
        await enviarCorreoFactura(data, ccUsuario);
      } catch (e) {
        correoError = e.message;
      }
    }
    if (body.estado === "Completada") {
      try {
        await enviarCorreoPago(data, ccUsuario);
      } catch (e) {
        correoError = e.message;
      }
    }
    return res.status(200).json({ orden: data, correoError });
  }

  if (req.method === "GET") {
    const empresaId = Number(req.query.empresa_id) || 1;

    // El frontend pide el HES real ANTES de aprobar, para poder generar el
    // PDF con el numero definitivo y mandarlo ya correcto en el primer correo
    // (ver Task 3 en index.html / OrdenAccionModal).
    if (req.query.siguiente_hes) {
      const { data: siguienteHes, error } = await db.rpc("siguiente_numero_hes", { p_empresa_id: empresaId });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ numero_hes: String(siguienteHes).padStart(8, "0") });
    }

    const { data, error } = await db
      .from("ordenes_compra")
      .select("*, proveedores(razon_social, rut), proyectos(nombre)")
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
    // Se identifica por la sesion (no por lo que mande el cliente) para que
    // quede registrado quien de verdad elaboro la OC en OCSys -- esto es
    // independiente del "Representante de Compra", que es solo un dato de
    // texto libre y puede ser otra persona.
    const session = verifyToken(parseCookie(req.headers.cookie, "ocsys_token"), process.env.SESSION_SECRET || "");
    const empresaId = Number(body.empresa_id) || 1;
    const estado = ESTADOS_OCSYS.includes(body.estado) ? body.estado : "Borrador";
    const cuotas = Array.isArray(body.cuotas) ? body.cuotas : [];

    const { data: empresa, error: empresaError } = await db.from("empresas").select("codigo").eq("id", empresaId).maybeSingle();
    if (empresaError) return res.status(500).json({ error: empresaError.message });
    const { data: siguiente, error: seqError } = await db.rpc("siguiente_numero_oc", { p_empresa_id: empresaId });
    if (seqError) return res.status(500).json({ error: seqError.message });
    const fechaHoy = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const numeroBase = (empresa?.codigo || "OC") + "-OC-" + fechaHoy + "-" + String(siguiente).padStart(5, "0");

    const camposBase = {
      numero_cotizacion: body.numero_cotizacion || null,
      proyecto_id: body.proyecto_id || null,
      creado_por_usuario: session ? session.usuario : null,
      proveedor_id: body.proveedor_id,
      empresa_id: empresaId,
      fecha: body.fecha || undefined,
      titulo: body.titulo || null,
      descripcion: body.descripcion || null,
      condiciones: body.condiciones || null,
      motivo: body.motivo || null,
      gerencia: body.gerencia || null,
      centro_costo_codigo: body.centro_costo_codigo || null,
      cuenta_contable_codigo: body.cuenta_contable_codigo || null,
      tipo_orden: body.tipo_orden || null,
      tipo_compra: body.tipo_compra || null,
      moneda: body.moneda || "CLP",
      estado,
      archivo_url: body.archivo_url || null,
      archivo_nombre: body.archivo_nombre || null,
      creado_por: body.creado_por || null,
    };

    // Una OC con mas de 1 cuota se divide en N filas independientes (mismo
    // numero_oc base + sufijo, cada una con su propio monto/HES/aprobacion) --
    // ver docs/superpowers/specs/2026-09-29-ordenes-en-cuotas-design.md. Con 1
    // sola cuota (o en Borrador) se sigue creando una sola fila, como siempre.
    const dividirEnCuotas = estado === "Pendiente aprobación" && cuotas.length > 1;

    if (!dividirEnCuotas) {
      const { data, error } = await db
        .from("ordenes_compra")
        .insert({
          ...camposBase,
          numero_oc: numeroBase,
          monto_neto: body.monto_neto || null,
          monto_iva: body.monto_iva || null,
          monto_total: body.monto_total || null,
          cuotas,
        })
        .select("*, proveedores(razon_social, rut)")
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json({ orden: data });
    }

    const filasCuotas = calcularFilasCuotas({ cuotas, montoNeto: body.monto_neto, montoIva: body.monto_iva, numeroBase });
    const filas = filasCuotas.map((f) => ({ ...camposBase, ...f, cuotas: [] }));
    const { data, error } = await db
      .from("ordenes_compra")
      .insert(filas)
      .select("*, proveedores(razon_social, rut)");
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ ordenes: data });
  }

  res.setHeader("Allow", "GET, POST, PUT, DELETE");
  return res.status(405).json({ error: "Método no permitido" });
}
