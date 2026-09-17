import { GoogleGenAI } from "@google/genai";
import { readJsonBody } from "./_supabase.js";

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

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const esErrorSaturacion = (e) => /UNAVAILABLE|"code":503|high demand|overloaded/i.test(e.message || "");

  let ultimoError;
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: [{
          role: "user",
          parts: [
            { text: "Este es un documento de factura (electrónica o física) emitida por un proveedor. Extrae el número/folio de la factura, el RUT de quien la EMITE (el proveedor, no el receptor), la moneda y los montos neto/IVA/total tal como aparecen impresos. No inventes datos que no esten en el documento." },
            { inlineData: { mimeType, data: base64 } },
          ],
        }],
        config: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      });

      const datos = JSON.parse(response.text);
      return res.status(200).json({ datos });
    } catch (e) {
      ultimoError = e;
      if (esErrorSaturacion(e) && intento < 3) {
        await new Promise((r) => setTimeout(r, 1500 * intento));
        continue;
      }
      break;
    }
  }

  const mensaje = esErrorSaturacion(ultimoError)
    ? "La IA está saturada en este momento (alta demanda en Gemini). Intenta de nuevo en unos segundos."
    : ultimoError.message;
  return res.status(502).json({ error: mensaje });
}
