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
    descripcion: { type: "string", description: "Descripción detallada de lo cotizado: qué incluye, alcance, ítems o condiciones relevantes. NO incluyas aquí montos, banco ni número de cuenta — esos ya tienen sus propios campos." },
    motivo: { type: "string", description: "Motivo o justificación de la compra/contratación, SOLO si el documento lo menciona explícitamente (por ejemplo, una nota del proveedor sobre para qué se solicita el servicio). Si el documento NO lo indica explícitamente, este campo debe quedar como cadena vacía \"\" — no expliques por qué está vacío, no escribas nada." },
    titulo: { type: "string", description: "Encabezado de MÁXIMO 8 palabras que resuma la descripción de arriba, como el asunto de un correo. PROHIBIDO incluir montos, nombres de banco, números de cuenta, u oraciones explicativas. Ejemplo correcto: 'Automatización de flujos de trabajo'. Ejemplo incorrecto (no hagas esto): una oración larga o con cifras." },
    moneda: { type: "string", enum: ["CLP", "USD", "UF"] },
    monto_neto: { type: "number", description: "Monto neto (sin IVA)" },
    monto_iva: { type: "number", description: "Monto de IVA, si se indica" },
    monto_total: { type: "number", description: "Monto total (con IVA)" },
  },
  propertyOrdering: [
    "proveedor_rut", "proveedor_razon_social",
    "contacto_nombre", "contacto_apellido", "contacto_telefono", "contacto_celular", "contacto_correo",
    "banco", "tipo_cuenta", "numero_cuenta",
    "descripcion", "motivo", "titulo",
    "moneda", "monto_neto", "monto_iva", "monto_total",
  ],
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
            { text: "Esta es una cotización enviada por un proveedor a Patagónica Inmobiliaria. Extrae TODOS los datos solicitados en el esquema, incluyendo los datos bancarios (banco, tipo de cuenta, número de cuenta) y los datos de contacto (nombre, teléfono, celular, correo) si aparecen en el documento — no los omitas. Cada dato va SOLO en su propio campo: los montos van en monto_neto/monto_iva/monto_total, el banco y la cuenta van en banco/tipo_cuenta/numero_cuenta, nunca los repitas como texto dentro de titulo, descripcion o motivo. El titulo es un encabezado de máximo 8 palabras, sin cifras ni datos bancarios. El motivo debe quedar como cadena vacía si el documento no indica explícitamente para qué se solicita la compra — no escribas frases como 'no se indica motivo', simplemente déjalo vacío." },
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
