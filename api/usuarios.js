import { supabase, readJsonBody } from "./_supabase.js";
import { hashPassword } from "./_auth.js";
import { verifyToken, parseCookie } from "./_session.js";

function toPublic(u) {
  const { password_hash, ...rest } = u;
  return { ...rest, tiene_password: !!password_hash };
}

// Unico usuario con acceso completo a Administracion (ver/crear/editar a
// cualquiera). El resto solo puede ver y editar su propia cuenta (para
// cambiar su contraseña), sin importar su nivel_aprobacion -- ese nivel es
// para aprobar OC, un permiso distinto al de administrar usuarios.
const SUPERADMIN = "amelendez@patagonica.cl";

export default async function handler(req, res) {
  const db = supabase();

  if (req.method === "GET") {
    // La lista completa trae el login (correo) y nivel/alcance de cada
    // usuario de todas las empresas -- solo el superadmin la ve entera;
    // cualquier otro usuario autenticado solo ve su propia fila (para poder
    // cambiar su propia contraseña desde Administración).
    const session = verifyToken(parseCookie(req.headers.cookie, "ocsys_token"), process.env.SESSION_SECRET || "");
    if (!session) return res.status(401).json({ error: "No autenticado" });
    let query = db.from("usuarios").select("*").order("nombre", { ascending: true });
    if (session.usuario !== SUPERADMIN) query = query.eq("id", session.id);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ usuarios: data.map(toPublic) });
  }

  if (req.method === "PUT") {
    const session = verifyToken(parseCookie(req.headers.cookie, "ocsys_token"), process.env.SESSION_SECRET || "");
    if (!session) return res.status(401).json({ error: "No autenticado" });

    if (session.usuario !== SUPERADMIN) {
      // Autoservicio: cualquier usuario puede cambiar su propia contraseña,
      // pero nada mas (ni su nombre, ni su nivel de aprobacion, ni su
      // acceso por empresa/proyecto) -- eso solo lo toca el superadmin.
      const id = req.query.id;
      if (!id || id !== session.id) {
        return res.status(403).json({ error: "Solo puedes editar tu propia cuenta" });
      }
      const body = await readJsonBody(req);
      if (!body.password) return res.status(400).json({ error: "Ingresa la nueva contraseña" });
      const { data, error } = await db
        .from("usuarios")
        .update({ password_hash: hashPassword(body.password), updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ usuario: toPublic(data) });
    }
  }

  if (req.method === "POST" || req.method === "PUT") {
    // Crear usuarios nuevos, o editar a CUALQUIER usuario (nombre, nivel de
    // aprobacion, acceso por empresa/proyecto) -- exclusivo del superadmin;
    // el autoservicio (editar la propia contraseña) ya se resolvio arriba.
    const session = verifyToken(parseCookie(req.headers.cookie, "ocsys_token"), process.env.SESSION_SECRET || "");
    if (!session || session.usuario !== SUPERADMIN) {
      return res.status(403).json({ error: "No tienes permiso para gestionar usuarios" });
    }

    const body = await readJsonBody(req);
    if (!body.nombre || !body.apellido || !body.usuario) {
      return res.status(400).json({ error: "nombre, apellido y usuario son obligatorios" });
    }
    const nivel = Number(body.nivel_aprobacion);
    if (nivel !== 0 && nivel !== 1) {
      return res.status(400).json({ error: "nivel_aprobacion debe ser 0 o 1" });
    }

    // Si viene un proyecto puntual, la empresa se deriva siempre de ese
    // proyecto (nunca se confia en un empresa_id suelto que mande el
    // cliente) -- evita guardar una combinacion inconsistente (proyecto de
    // una empresa con el empresa_id de otra).
    let empresaIdFinal = body.empresa_id ? Number(body.empresa_id) : null;
    let proyectoIdFinal = body.proyecto_id || null;
    if (proyectoIdFinal) {
      const { data: proyecto, error: proyectoError } = await db
        .from("proyectos").select("empresa_id").eq("id", proyectoIdFinal).maybeSingle();
      if (proyectoError) return res.status(500).json({ error: proyectoError.message });
      if (!proyecto) return res.status(400).json({ error: "El proyecto seleccionado no existe" });
      empresaIdFinal = proyecto.empresa_id;
    }

    // Centro de Costo / Cuenta Contable fijos (ej. proveedores en autogestion
    // como Gestion Obras): se validan contra la empresa ya resuelta arriba,
    // nunca se confia en el codigo suelto que mande el cliente.
    const centroCostoFinal = body.centro_costo_codigo || null;
    let cuentaContableFinal = body.cuenta_contable_codigo || null;
    if (centroCostoFinal) {
      const { data: cc, error: ccError } = await db
        .from("centros_costo").select("codigo").eq("codigo", centroCostoFinal).eq("empresa_id", empresaIdFinal).maybeSingle();
      if (ccError) return res.status(500).json({ error: ccError.message });
      if (!cc) return res.status(400).json({ error: "El Centro de Costo no corresponde a la empresa seleccionada" });
    }
    if (cuentaContableFinal) {
      const { data: cta, error: ctaError } = await db
        .from("cuentas_contables").select("codigo, centro_costo_codigo").eq("codigo", cuentaContableFinal).eq("empresa_id", empresaIdFinal).maybeSingle();
      if (ctaError) return res.status(500).json({ error: ctaError.message });
      if (!cta || (centroCostoFinal && cta.centro_costo_codigo !== centroCostoFinal)) {
        return res.status(400).json({ error: "La Cuenta Contable no corresponde al Centro de Costo/empresa seleccionados" });
      }
    }

    // Proveedores permitidos (ej. Gestion Obras autogestionando sus propias
    // OC, que puede facturar bajo mas de una razon social): se valida que
    // cada uno exista -- proveedores es un catalogo compartido, no esta
    // ligado a una empresa en particular.
    const proveedorIdsFinal = Array.isArray(body.proveedor_ids) ? body.proveedor_ids.filter(Boolean) : [];
    if (proveedorIdsFinal.length) {
      const { data: provs, error: provError } = await db
        .from("proveedores").select("id").in("id", proveedorIdsFinal);
      if (provError) return res.status(500).json({ error: provError.message });
      if (!provs || provs.length !== proveedorIdsFinal.length) {
        return res.status(400).json({ error: "Alguno de los proveedores seleccionados no existe" });
      }
    }

    const fields = {
      nombre: body.nombre,
      apellido: body.apellido,
      usuario: body.usuario,
      nivel_aprobacion: nivel,
      empresa_id: empresaIdFinal,
      proyecto_id: proyectoIdFinal,
      centro_costo_codigo: centroCostoFinal,
      cuenta_contable_codigo: cuentaContableFinal,
      proveedor_ids: proveedorIdsFinal.length ? proveedorIdsFinal : null,
    };
    if (body.password) fields.password_hash = hashPassword(body.password);

    if (req.method === "PUT") {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "id es obligatorio" });
      const { data, error } = await db
        .from("usuarios")
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) {
        if (error.code === "23505") return res.status(409).json({ error: "Ya existe un usuario con ese nombre de usuario" });
        return res.status(500).json({ error: error.message });
      }
      return res.status(200).json({ usuario: toPublic(data) });
    }

    const { data, error } = await db.from("usuarios").insert(fields).select().single();
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: "Ya existe un usuario con ese nombre de usuario" });
      return res.status(500).json({ error: error.message });
    }
    return res.status(201).json({ usuario: toPublic(data) });
  }

  res.setHeader("Allow", "GET, POST, PUT");
  return res.status(405).json({ error: "Método no permitido" });
}
