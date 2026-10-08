// Endpoint temporal de un solo uso: correo de bienvenida a Claudio Aguilera
// como nuevo aprobador de OCFast. Se borra apenas se confirma el envío.

async function getGmailToken() {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error("OAuth2 Gmail error: " + (await res.text()).slice(0, 300));
  const data = await res.json();
  if (!data.access_token) throw new Error("OAuth2 Gmail: sin access_token");
  return data.access_token;
}

function buildRawEmail(to, from, subject, htmlBody, cc) {
  const fromEncoded = `=?UTF-8?B?${Buffer.from("Patagónica Inmobiliaria").toString("base64")}?= <${from}>`;
  const subjectEncoded = `=?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`;
  const headers = [`From: ${fromEncoded}`, `To: ${to}`];
  if (cc) headers.push(`Cc: ${cc}`);
  headers.push(`Subject: ${subjectEncoded}`, "MIME-Version: 1.0", "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64");
  const raw = headers.join("\r\n") + "\r\n\r\n" + Buffer.from(htmlBody).toString("base64");
  return Buffer.from(raw).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sendGmail(token, to, from, subject, htmlBody, cc) {
  const raw = buildRawEmail(to, from, subject, htmlBody, cc);
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Gmail ${res.status}: ${err.error?.message || JSON.stringify(err).slice(0, 200)}`);
  }
  return res.json();
}

const FILAS = [
  ["OC-00236", "Desarrollo de Proyecto Reconversión Centro Bodegaje El Cortijo", "UF 535,50 (3 cuotas)"],
  ["OC-00237", "Desarrollo de Proyecto Reconversión Centro Bodegaje El Cortijo", "UF 535,50 (3 cuotas)"],
  ["PA-OC-00333", "Honorarios Climatización Mall El Cortijo", "UF 180,00 (2 cuotas)"],
  ["PA-OC-00334", "Cotización Proyecto Arquitectónico Outlet", "UF 65,00"],
  ["PA-OC-00335", "Proyectos Pavimentación Centro Comercial El Montijo", "UF 276,00 (7 cuotas)"],
  ["PA-OC-00336", "Proyecto entibación socalzado El Montijo", "UF 119,00 (2 cuotas)"],
  ["PA-OC-00337", "Cotización anclajes y herramienta dispensadora", "$1.111.838"],
  ["PA-OC-20261001-00328", "Pintura nivel 2 oficinas", "$1.342.469 (1 cuota pendiente)"],
];

export default async function handler(req, res) {
  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET || !process.env.GMAIL_REFRESH_TOKEN) {
    return res.status(500).json({ error: "Credenciales de Gmail no configuradas" });
  }
  const from = process.env.GMAIL_FROM || "facturacion@patagonica.cl";
  const to = "caguilera@patagonica.cl";
  const cc = "amelendez@patagonica.cl";
  const asunto = "Bienvenido a OCFast — 8 Órdenes de Compra pendientes de tu aprobación";

  const P = 'style="margin:0 0 14px"';
  const tabla = `<table style="border-collapse:collapse;margin:6px 0 14px" cellpadding="8">
    <tr style="background:#f2f2f2"><th align="left">N° OC</th><th align="left">Título</th><th align="left">Monto pendiente</th></tr>
    ${FILAS.map(([n, t, m]) => `<tr><td>${n}</td><td>${t}</td><td>${m}</td></tr>`).join("")}
  </table>`;

  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1a1a1a;font-size:14px">
    <p ${P}>Estimado Claudio,</p>
    <p ${P}>Te damos la bienvenida a OCFast, el sistema de Órdenes de Compra de Patagónica Inmobiliaria, Campo Mar SPA y Evox/Sánchez Hermanos SpA. Quedaste configurado como aprobador: de ahora en adelante, cada vez que se genere una OC nueva, te llegará un aviso por este medio.</p>
    <p ${P}>Actualmente hay <b>8 Órdenes de Compra</b> esperando tu aprobación:</p>
    ${tabla}
    <p ${P}>Ingresa a OCFast (Órdenes de Compra) para revisarlas y aprobarlas.</p>
    <p style="margin:0 0 14px">Saludos Cordiales,</p>
    <p style="margin:0 0 14px"><b>Coordinación de Compras y Servicios Generales</b><br>
    Av. Américo Vespucio 2680, Piso 11, Conchalí.</p>
    <p style="color:#888888;font-size:11px;text-align:center;margin-top:24px">Correo generado automáticamente por OCFast</p>
  </body></html>`;

  try {
    const token = await getGmailToken();
    await sendGmail(token, to, from, asunto, html, cc);
    return res.status(200).json({ ok: true, enviado_a: to, cc });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
