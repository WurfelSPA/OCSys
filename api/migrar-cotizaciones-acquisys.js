import { supabase, readJsonBody } from "./_supabase.js";
import { verifyToken, parseCookie } from "./_session.js";

// Herramienta interna, de uso puntual: migra las cotizaciones historicas de
// Acquisys (URL ya resuelta por su propio endpoint /admin/order) al bucket
// de Storage de OCSys, y las enlaza en ordenes_compra por numero_oc.
// Requiere sesion valida (cualquier usuario logueado). No sobreescribe
// ordenes que ya tengan archivo_url cargado.

async function procesarUno(db, o, userToken) {
  const filename = o.cotizacion.split("/").pop();
  const r = await fetch(o.cotizacion, { headers: { user_token: userToken } });
  if (!r.ok) throw new Error("descarga falló: " + r.status);
  const contentType = r.headers.get("content-type") || "";
  if (!contentType.includes("pdf")) throw new Error("respuesta no es un PDF (" + contentType + ")");
  const buf = Buffer.from(await r.arrayBuffer());

  const path = "acquisys-historico/" + filename;
  const { error: upErr } = await db.storage.from("ocsys-archivos").upload(path, buf, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (upErr) throw new Error("upload storage: " + upErr.message);

  const { data: pub } = db.storage.from("ocsys-archivos").getPublicUrl(path);

  const { data: updated, error: dbErr } = await db
    .from("ordenes_compra")
    .update({ archivo_url: pub.publicUrl, archivo_nombre: filename })
    .eq("numero_oc", o.num_order)
    .is("archivo_url", null)
    .select("id");
  if (dbErr) throw new Error("update db: " + dbErr.message);

  return { num_order: o.num_order, ok: true, actualizado: (updated || []).length > 0, url: pub.publicUrl };
}

async function procesarEnLotes(db, ordenes, userToken, concurrencia) {
  const resultados = [];
  for (let i = 0; i < ordenes.length; i += concurrencia) {
    const lote = ordenes.slice(i, i + concurrencia);
    const r = await Promise.all(lote.map((o) =>
      procesarUno(db, o, userToken).catch((e) => ({ num_order: o.num_order, ok: false, error: e.message }))
    ));
    resultados.push(...r);
  }
  return resultados;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método no permitido" });
  }

  const session = verifyToken(parseCookie(req.headers.cookie, "ocsys_token"), process.env.SESSION_SECRET || "");
  if (!session) return res.status(401).json({ error: "No autenticado" });

  const { userToken, ordenes } = await readJsonBody(req);
  if (!userToken || !Array.isArray(ordenes) || !ordenes.length) {
    return res.status(400).json({ error: "userToken y ordenes (array) son obligatorios" });
  }

  const vistos = new Set();
  const unicas = ordenes.filter((o) => {
    if (!o.num_order || !o.cotizacion || vistos.has(o.num_order)) return false;
    vistos.add(o.num_order);
    return true;
  });

  const db = supabase();
  const resultados = await procesarEnLotes(db, unicas, userToken, 8);

  const ok = resultados.filter((r) => r.ok && r.actualizado).length;
  const yaTenian = resultados.filter((r) => r.ok && !r.actualizado).length;
  const conError = resultados.filter((r) => !r.ok);

  return res.status(200).json({
    total: unicas.length, actualizadas: ok, yaTenianArchivo: yaTenian,
    errores: conError.length, detalleErrores: conError,
  });
}
