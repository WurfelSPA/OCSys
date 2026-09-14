import Anthropic from "@anthropic-ai/sdk";
import { readJsonBody } from "./_supabase.js";

const client = new Anthropic();

const EXTRACT_TOOL = {
  name: "extraer_datos_cotizacion",
  description: "Registra los datos clave leídos de una cotización de proveedor",
  input_schema: {
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
    additionalProperties: false,
  },
  strict: true,
};

const EXT_MEDIA = {
  pdf: { kind: "document", media_type: "application/pdf" },
  jpg: { kind: "image", media_type: "image/jpeg" },
  jpeg: { kind: "image", media_type: "image/jpeg" },
  png: { kind: "image", media_type: "image/png" },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método no permitido" });
  }

  const { filename, base64 } = await readJsonBody(req);
  if (!filename || !base64) return res.status(400).json({ error: "filename y base64 son obligatorios" });

  const ext = filename.split(".").pop().toLowerCase();
  const media = EXT_MEDIA[ext];
  if (!media) {
    return res.status(400).json({ error: "La lectura con IA solo funciona con PDF, JPG o PNG. Word/Excel debes completarlos manualmente." });
  }

  const contentBlock = media.kind === "document"
    ? { type: "document", source: { type: "base64", media_type: media.media_type, data: base64 } }
    : { type: "image", source: { type: "base64", media_type: media.media_type, data: base64 } };

  try {
    const message = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 2048,
      output_config: { effort: "low" },
      tools: [EXTRACT_TOOL],
      tool_choice: { type: "tool", name: "extraer_datos_cotizacion" },
      messages: [{
        role: "user",
        content: [
          contentBlock,
          { type: "text", text: "Esta es una cotización enviada por un proveedor a Patagónica Inmobiliaria. Extrae los datos solicitados con la herramienta." },
        ],
      }],
    });

    const toolUse = message.content.find((b) => b.type === "tool_use");
    if (!toolUse) return res.status(500).json({ error: "No se pudo leer la cotización" });
    return res.status(200).json({ datos: toolUse.input });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
