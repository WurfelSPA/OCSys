import { GoogleGenAI } from "@google/genai";
import { readJsonBody } from "./_supabase.js";

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    proveedor_rut: { type: "string", description: "RUT del proveedor/emisor de la cotización, formato XX.XXX.XXX-X" },
    proveedor_razon_social: { type: "string", description: "Razón social o nombre del proveedor/emisor" },
    contacto_nombre: { type: "string", description: "Nombre de pila de la persona de contacto que firma o emite la cotización" },
    contacto_apellido: { type: "string", description: "Apellido de la persona de contacto" },
    contacto_telefono: { type: "string", description: "Teléfono fijo de contacto, si se indica" },
    contacto_celular: { type: "string", description: "Celular/móvil de contacto, si se indica" },
    contacto_correo: { type: "string", description: "Correo electrónico de contacto del proveedor" },
    banco: { type: "string", description: "Nombre del banco en los datos bancarios" },
    tipo_cuenta: { type: "string", description: "Tipo de cuenta bancaria (Cuenta Corriente, Cuenta Vista, Cuenta de Ahorro)" },
    numero_cuenta: { type: "string", description: "Número de cuenta bancaria" },
    titulo: { type: "string", description: "Referencia MUY corta (máx. 8-10 palabras) del servicio o producto cotizado, a modo de encabezado. No repitas aquí el contenido completo de la descripción." },
    descripcion: { type: "string", description: "Descripción detallada de lo cotizado: qué incluye, alcance, ítems o condiciones relevantes. Debe ser distinta y más extensa que el título, no una copia." },
    motivo: { type: "string", description: "Motivo o justificación de la compra/contratación, SOLO si el documento lo menciona explícitamente (por ejemplo, una nota del proveedor sobre para qué se solicita el servicio). Si no aparece explícitamente, dejar vacío." },
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
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: [{
        role: "user",
        parts: [
          { text: "Esta es una cotización enviada por un proveedor a Patagónica Inmobiliaria. Extrae TODOS los datos solicitados en el esquema, incluyendo los datos bancarios (banco, tipo de cuenta, número de cuenta) y los datos de contacto (nombre, teléfono, celular, correo) si aparecen en el documento — no los omitas. Importante: título y descripción son campos DISTINTOS — el título es un encabezado muy corto, y la descripción es el detalle completo de lo cotizado (ítems, alcance, condiciones); no dupliques el mismo texto en ambos. El motivo solo debe llenarse si el documento indica explícitamente para qué se solicita la compra; si no lo dice, déjalo vacío en vez de inventarlo." },
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
