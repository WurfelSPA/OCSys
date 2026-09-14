import { supabase, readJsonBody } from "./_supabase.js";

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

  if (req.method === "POST") {
    const body = await readJsonBody(req);
    if (!body.razon_social || !body.rut || !body.tipo_documento) {
      return res.status(400).json({ error: "razon_social, rut y tipo_documento son obligatorios" });
    }
    const { data, error } = await db
      .from("proveedores")
      .insert({
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
      })
      .select()
      .single();
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: "Ya existe un proveedor con ese RUT" });
      return res.status(500).json({ error: error.message });
    }
    return res.status(201).json({ proveedor: data });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Método no permitido" });
}
