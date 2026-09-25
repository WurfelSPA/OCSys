import { readJsonBody } from "./_supabase.js";
import { leerDocumentoConFallback } from "./_ia-lectura.js";

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    numero_factura: { type: "string", description: "Número o folio de la factura tal como aparece impreso en el documento (ej. 'N°101', 'Factura Electrónica N°304')." },
    proveedor_rut: { type: "string", description: "RUT del emisor de la factura (quien la emite, no quien la recibe), formato XX.XXX.XXX-X" },
    moneda: { type: "string", enum: ["CLP", "USD", "UF"] },
    monto_neto: { type: "number", description: "Monto neto (sin IVA)" },
    monto_iva: { type: "number", description: "Monto de IVA, si se indica" },
    monto_total: { type: "number", description: "Monto total de la factura (con IVA)" },
  },
  propertyOrdering: ["numero_factura", "proveedor_rut", "moneda", "monto_neto", "monto_iva", "monto_total"],
  required: ["monto_total"],
};

const INSTRUCCIONES = "Este es un documento de factura (electrónica o física) emitida por un proveedor. Extrae el número/folio de la factura, el RUT de quien la EMITE (el proveedor, no el receptor), la moneda y los montos neto/IVA/total tal como aparecen impresos. No inventes datos que no esten en el documento — si un dato no aparece, usa cadena vacía \"\".";

const PROMPT_GENERICO = `${INSTRUCCIONES}

Responde ÚNICAMENTE con un objeto JSON (sin texto adicional, sin bloques de código markdown) con exactamente estas claves:
{
  "numero_factura": string, "proveedor_rut": string,
  "moneda": "CLP" | "USD" | "UF", "monto_neto": number, "monto_iva": number, "monto_total": number
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
