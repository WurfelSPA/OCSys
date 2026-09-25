import { readJsonBody } from "./_supabase.js";
import { leerDocumentoConFallback } from "./_ia-lectura.js";

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({
      nodeVersion: process.version,
      hasGemini: !!process.env.GEMINI_API_KEY,
      hasGroq: !!process.env.GROQ_API_KEY,
      hasOpenRouter: !!process.env.OPENROUTER_API_KEY,
    });
  }

  const eventos = [];
  try {
    const { filename, base64 } = await readJsonBody(req);
    const ext = (filename || "").split(".").pop().toLowerCase();
    const mimeType = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" }[ext];

    const resultado = await leerDocumentoConFallback({
      promptGemini: "Responde solo con un JSON: {\"ok\": true}",
      promptGenerico: "Responde UNICAMENTE con este JSON, sin texto adicional: {\"ok\": true}",
      mimeType,
      base64,
      geminiSchema: { type: "object", properties: { ok: { type: "boolean" } } },
      geminiModel: "gemini-3.6-flash",
      onProgress: (m) => eventos.push({ t: Date.now(), motor: m }),
    });
    return res.status(200).json({ eventos, resultado });
  } catch (e) {
    return res.status(200).json({
      eventos,
      error: {
        message: e && e.message,
        name: e && e.name,
        stack: e && e.stack,
        string: String(e),
      },
    });
  }
}
