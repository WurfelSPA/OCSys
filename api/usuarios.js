import { supabase, readJsonBody } from "./_supabase.js";
import { hashPassword, verifyPassword } from "./_auth.js";
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

  if (req.method === "POST" && req.query.action === "verificar") {
    const { id, password } = await readJsonBody(req);
    if (!id || !password) return res.status(400).json({ error: "id y password son obligatorios" });
    const { data: usuario, error } = await db.from("usuarios").select("password_hash").eq("id", id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!usuario || !verifyPassword(password, usuario.password_hash)) {
      return res.status(401).json({ error: "Contraseña incorrecta" });
    }
    return res.status(200).json({ ok: true });
  }

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

    const fields = {
      nombre: body.nombre,
      apellido: body.apellido,
      usuario: body.usuario,
      nivel_aprobacion: nivel,
      empresa_id: empresaIdFinal,
      proyecto_id: proyectoIdFinal,
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
