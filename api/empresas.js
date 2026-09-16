import { supabase } from "./_supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método no permitido" });
  }

  const db = supabase();
  const { data, error } = await db.from("empresas").select("*").order("id");
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ empresas: data });
}
