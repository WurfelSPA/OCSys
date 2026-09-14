import { supabase, readJsonBody } from "./_supabase.js";
import { verifyToken, parseCookie } from "./_session.js";

const CAMPOS_PARA_FICHA_COMPLETA = [
  "giro_comercial", "direccion_comercial", "region", "ciudad",
  "contacto_correo", "banco", "tipo_cuenta", "numero_cuenta",
];

function calcularDatosCompletos(fields) {
  const tieneContactoTelefonico = !!(fields.telefono || fields.contacto_telefono || fields.contacto_celular);
  return tieneContactoTelefonico && CAMPOS_PARA_FICHA_COMPLETA.every((k) => !!fields[k]);
}

export default async function handler(req, res) {
  const db = supabase();

  if (req.method === "GET") {
    const { data, error } = await db
      .from("proveedores")
      .select("*")
      .eq("activo", true)
      .order("razon_social", { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ proveedores: data });
  }

  if (req.method === "POST" || req.method === "PUT") {
    const body = await readJsonBody(req);
    if (!body.razon_social || !body.rut || !body.tipo_documento) {
      return res.status(400).json({ error: "razon_social, rut y tipo_documento son obligatorios" });
    }
    const fields = {
      razon_social: body.razon_social,
      tipo_documento: body.tipo_documento,
      rut: body.rut,
      tamano_empresa: body.tamano_empresa || null,
      giro_comercial: body.giro_comercial || null,
      direccion_comercial: body.direccion_comercial || null,
      departamento_oficina: body.departamento_oficina || null,
      region: body.region || null,
      ciudad: body.ciudad || null,
      telefono: body.telefono || null,
      sitio_web: body.sitio_web || null,
      contacto_nombre: body.contacto_nombre || null,
      contacto_apellido: body.contacto_apellido || null,
      contacto_telefono: body.contacto_telefono || null,
      contacto_celular: body.contacto_celular || null,
      contacto_correo: body.contacto_correo || null,
      banco: body.banco || null,
      tipo_cuenta: body.tipo_cuenta || null,
      numero_cuenta: body.numero_cuenta || null,
    };
    fields.datos_completos = calcularDatosCompletos(fields);

    if (req.method === "PUT") {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "id es obligatorio" });
      const { data, error } = await db
        .from("proveedores")
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) {
        if (error.code === "23505") return res.status(409).json({ error: "Ya existe un proveedor con ese RUT" });
        return res.status(500).json({ error: error.message });
      }
      return res.status(200).json({ proveedor: data });
    }

    const { data, error } = await db.from("proveedores").insert(fields).select().single();
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: "Ya existe un proveedor con ese RUT" });
      return res.status(500).json({ error: error.message });
    }
    return res.status(201).json({ proveedor: data });
  }

  if (req.method === "DELETE") {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "id es obligatorio" });
    const session = verifyToken(parseCookie(req.headers.cookie, "ocsys_token"), process.env.SESSION_SECRET || "");
    if (!session) return res.status(401).json({ error: "No autenticado" });
    if (session.nivel_aprobacion !== 1) {
      return res.status(403).json({ error: "No tienes nivel de aprobación para eliminar proveedores" });
    }
    const { error } = await db
      .from("proveedores")
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

  res.setHeader("Allow", "GET, POST, PUT, DELETE");
  return res.status(405).json({ error: "Método no permitido" });
}
