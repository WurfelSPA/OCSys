import { supabase } from "./_supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método no permitido" });
  }

  const db = supabase();
  const { data, error, count } = await db
    .from("ordenes_compra_historicas")
    .select("*", { count: "exact" })
    .order("numero_solicitud", { ascending: false })
    .limit(500);
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ historicas: data, total: count });
}
