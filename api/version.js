// Version "activa" del deploy -- Vercel expone el SHA del commit de cada
// deploy automaticamente (VERCEL_GIT_COMMIT_SHA), sin que haya que llevar un
// numero de version a mano. El frontend compara esto contra lo que vio al
// cargar la pagina para detectar que quedo en una version vieja mientras se
// hacen cambios seguidos (ver validarVersion en index.html).
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método no permitido" });
  }
  return res.status(200).json({ version: process.env.VERCEL_GIT_COMMIT_SHA || "dev" });
}
