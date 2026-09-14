import { GoogleGenAI } from "@google/genai";
import { readJsonBody } from "./_supabase.js";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    proveedor_rut: { type: "string", description: "RUT del proveedor que emite la cotización, formato XX.XXX.XXX-X" },
    proveedor_razon_social: { type: "string", description: "Razón social del proveedor" },
    titulo: { type: "string", description: "Referencia corta / título del servicio o producto cotizado" },
    descripcion: { type: "string", description: "Descripción detallada de lo cotizado" },
    moneda: { type: "string", enum: ["CLP", "USD", "UF"] },
    monto_neto: { type: "number", description: "Monto neto (sin IVA)" },
    monto_iva: { type: "number", description: "Monto de IVA, si se indica" },
    monto_total: { type: "number", description: "Monto total (con IVA)" },
  },
  required: ["moneda", "monto_neto", "monto_total"],
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
    return res.status(400).json({ error: "La lectura con IA solo funciona con PDF, JPG o PNG. Word/Excel debes completarlos manualmente." });
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{
        role: "user",
        parts: [
          { text: "Esta es una cotización enviada por un proveedor a Patagónica Inmobiliaria. Extrae los datos solicitados en el esquema." },
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
    return res.status(500).json({ error: e.message });
  }
}
