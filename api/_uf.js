// Valor UF por fecha, para convertir a UF las OC en CLP del menu Proyectos
// (el presupuesto de un proyecto se lleva en UF). Se consulta mindicador.cl
// (misma fuente que ya usa el frontend) y se cachea en la tabla uf_diaria
// para no repetir llamadas -- la UF de un dia pasado nunca cambia.

const TIMEOUT_MS = 5000;

function hoyChile() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
}

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// mindicador entrega la fecha como "2026-09-22T03:00:00.000Z" (medianoche
// de Chile en UTC) -- se toma la fecha calendario chilena.
function fechaSerie(s) {
  return new Date(s.fecha).toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
}

// Devuelve { "YYYY-MM-DD": valor } para todas las fechas pedidas. Fechas
// futuras o sin dato (mindicador devuelve serie vacia) usan el valor
// conocido mas cercano anterior, o el de hoy.
export async function valoresUF(db, fechas) {
  const hoy = hoyChile();
  const pedidas = [...new Set((fechas || []).filter(Boolean).map((f) => String(f).slice(0, 10)))];
  const resultado = {};

  const { data: cache } = pedidas.length
    ? await db.from("uf_diaria").select("fecha, valor").in("fecha", pedidas)
    : { data: [] };
  for (const c of cache || []) resultado[c.fecha] = Number(c.valor);

  const faltantes = pedidas.filter((f) => resultado[f] === undefined && f <= hoy);
  const nuevos = [];
  await Promise.all(faltantes.map(async (f) => {
    const [y, m, d] = f.split("-");
    const j = await fetchJson(`https://mindicador.cl/api/uf/${d}-${m}-${y}`);
    const v = j && j.serie && j.serie[0] && Number(j.serie[0].valor);
    if (v) { resultado[f] = v; nuevos.push({ fecha: f, valor: v }); }
  }));

  // UF de hoy: sirve para el equivalente CLP del presupuesto y como respaldo.
  let ufHoy = resultado[hoy];
  if (ufHoy === undefined) {
    const { data: c } = await db.from("uf_diaria").select("valor").eq("fecha", hoy).maybeSingle();
    if (c) ufHoy = Number(c.valor);
  }
  if (ufHoy === undefined) {
    const j = await fetchJson("https://mindicador.cl/api/uf");
    const serie = (j && j.serie) || [];
    for (const s of serie) {
      const f = fechaSerie(s);
      if (f === hoy) { ufHoy = Number(s.valor); nuevos.push({ fecha: hoy, valor: ufHoy }); }
    }
    if (ufHoy === undefined && serie[0]) ufHoy = Number(serie[0].valor);
  }
  if (ufHoy === undefined) {
    const { data: ult } = await db.from("uf_diaria").select("valor").order("fecha", { ascending: false }).limit(1).maybeSingle();
    if (ult) ufHoy = Number(ult.valor);
  }

  if (nuevos.length) {
    await db.from("uf_diaria").upsert(nuevos, { onConflict: "fecha", ignoreDuplicates: true });
  }

  for (const f of pedidas) {
    if (resultado[f] === undefined && ufHoy !== undefined) resultado[f] = ufHoy;
  }
  return { porFecha: resultado, ufHoy: ufHoy ?? null };
}
