export default async function handler(req, res) {
  try {
    return res.status(200).json({
      nodeVersion: process.version,
      hasGemini: !!process.env.GEMINI_API_KEY,
      hasGroq: !!process.env.GROQ_API_KEY,
      hasOpenRouter: !!process.env.OPENROUTER_API_KEY,
      groqModel: process.env.GROQ_VISION_MODEL || "(default)",
      openrouterModel: process.env.OPENROUTER_VISION_MODEL || "(default)",
    });
  } catch (e) {
    return res.status(500).json({ error: e.message, stack: e.stack });
  }
}
