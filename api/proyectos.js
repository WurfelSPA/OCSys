import { supabase, readJsonBody } from "./_supabase.js";

// Catalogo simple de proyectos, solo para poder filtrar/agrupar en los
// informes -- no se imprime en la OC ni se usa en el flujo de aprobacion.
// Cada empresa parte con un proyecto "Contenedor" (usar cuando la OC no
// corresponde a ningun proyecto especifico).
export default async function handler(req, res) {
  const db = supabase();

  if (req.method === "GET") {
    const empresaId = Number(req.query.empresa_id) || 1;
    const { data, error } = await db
      .from("proyectos")
      .select("*")
      .eq("empresa_id", empresaId)
      .eq("activo", true)
      .order("created_at", { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ proyectos: data });
  }

  if (req.method === "POST") {
    const body = await readJsonBody(req);
    const nombre = (body.nombre || "").trim();
    if (!nombre) return res.status(400).json({ error: "nombre es obligatorio" });
    const empresaId = Number(body.empresa_id) || 1;

    const { data: existente } = await db
      .from("proyectos")
      .select("*")
      .eq("empresa_id", empresaId)
      .ilike("nombre", nombre)
      .maybeSingle();
    if (existente) return res.status(200).json({ proyecto: existente });

    const { data, error } = await db
      .from("proyectos")
      .insert({ empresa_id: empresaId, nombre })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ proyecto: data });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Método no permitido" });
}
