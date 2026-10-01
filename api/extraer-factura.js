import { readJsonBody } from "./_supabase.js";
import { leerDocumentoConFallback } from "./_ia-lectura.js";

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    numero_factura: { type: "string", description: "Número o folio de la factura tal como aparece impreso en el documento (ej. 'N°101', 'Factura Electrónica N°304')." },
    proveedor_rut: { type: "string", description: "RUT del emisor de la factura (quien la emite, no quien la recibe), formato XX.XXX.XXX-X" },
    receptor_rut: { type: "string", description: "RUT del RECEPTOR/cliente de la factura (bajo 'Señor(es):', 'Para:', 'Cliente:' o 'Dirigido a:' — el opuesto al proveedor_rut), formato XX.XXX.XXX-X. Si no aparece, usa cadena vacía \"\"." },
    moneda: { type: "string", enum: ["CLP", "USD", "UF"] },
    monto_neto: { type: "number", description: "Monto neto (sin IVA), en la moneda de los totales del documento (normalmente pesos chilenos, aunque el contrato sea en UF)" },
    monto_iva: { type: "number", description: "Monto de IVA, si se indica" },
    monto_total: { type: "number", description: "Monto total de la factura (con IVA)" },
    monto_neto_uf: {
      type: ["number", "null"],
      description: "Si el detalle de la factura muestra una cantidad expresada en UF (ej. columna 'Cantidad' con un valor como '150 UF', junto a un precio unitario que es el valor de la UF del día), el monto neto en UF (ej. 150). Esto es común en facturas chilenas por servicios con contrato en UF, donde los totales igual se emiten en pesos. Si el documento no muestra ningún monto en UF, usa null — no lo inventes ni lo calcules tú mismo.",
    },
  },
  propertyOrdering: ["numero_factura", "proveedor_rut", "receptor_rut", "moneda", "monto_neto", "monto_iva", "monto_total", "monto_neto_uf"],
  required: ["monto_total"],
};

const INSTRUCCIONES = "Este es un documento de factura (electrónica o física) emitida por un proveedor a una empresa cliente (Patagónica Inmobiliaria, Campo Mar SPA o Evox/Sánchez Hermanos SpA). El documento muestra DOS RUT distintos: el del EMISOR/proveedor (generalmente en el encabezado o membrete) y el del RECEPTOR/cliente (frecuentemente bajo 'Señor(es):', 'Para:', 'Cliente:' o 'Dirigido a:'). Extrae proveedor_rut SOLO del emisor y receptor_rut SOLO del receptor/cliente — NUNCA los confundas, aunque ambos estén etiquetados simplemente como 'RUT:' cerca de sus respectivos datos. Si alguno de los dos no aparece impreso, usa cadena vacía \"\" para ese campo — no inventes ni copies uno en el otro. Extrae también el número/folio de la factura, la moneda y los montos neto/IVA/total tal como aparecen impresos en los totales del documento (normalmente en pesos, aunque el contrato sea en UF). Si el detalle de la factura muestra además una cantidad expresada en UF (columna 'Cantidad' con algo como '150 UF', con un precio unitario que es el valor de la UF del día), extrae ese monto neto en UF en monto_neto_uf; si no, usa null. No inventes datos que no esten en el documento — si un dato no aparece, usa cadena vacía \"\" (o null para monto_neto_uf).";

const PROMPT_GENERICO = `${INSTRUCCIONES}

Responde ÚNICAMENTE con un objeto JSON (sin texto adicional, sin bloques de código markdown) con exactamente estas claves:
{
  "numero_factura": string, "proveedor_rut": string, "receptor_rut": string,
  "moneda": "CLP" | "USD" | "UF", "monto_neto": number, "monto_iva": number, "monto_total": number,
  "monto_neto_uf": number | null
}`;

const EXT_MIME = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método no permitido" });
  }

  const { filename, base64 } = await readJsonBody(req);
  if (!filename || !base64) return res.status(400).json({ error: "filename y base64 son obligatorios" });

  const ext = filename.split(".").pop().toLowerCase();
  const mimeType = EXT_MIME[ext];
  if (!mimeType) {
    return res.status(400).json({ error: "La lectura con IA solo funciona con PDF, JPG o PNG." });
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  const emitir = (linea) => { try { res.write(JSON.stringify(linea) + "\n"); } catch (_) {} };

  try {
    const { datos, motor } = await leerDocumentoConFallback({
      promptGemini: INSTRUCCIONES,
      promptGenerico: PROMPT_GENERICO,
      mimeType,
      base64,
      geminiSchema: RESPONSE_SCHEMA,
      geminiModel: "gemini-3.6-flash",
      onProgress: (motorCorto) => emitir({ tipo: "progreso", motor: motorCorto }),
    });
    emitir({ tipo: "resultado", datos, motor });
  } catch (e) {
    emitir({ tipo: "error", error: e.message });
  }
  res.end();
}
