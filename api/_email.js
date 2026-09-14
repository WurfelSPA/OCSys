async function fetchAsBase64(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("No se pudo descargar el archivo adjunto: " + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  return buf.toString("base64");
}

export async function enviarCorreoAprobacion(orden, aprobador) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY no configurado");
  const from = process.env.RESEND_FROM || "facturacion@patagonica.cl";

  const proveedor = orden.proveedores || {};
  const to = proveedor.contacto_correo;
  if (!to) throw new Error("El proveedor no tiene correo de contacto configurado");

  const asunto = `${orden.numero_oc} / HES ${orden.numero_hes} ${orden.titulo || ""}`.trim();
  const notaUF = orden.moneda === "UF"
    ? `<p><i><u>Si el monto es en UF, facturar según el valor de la UF del día 30 del mes al que corresponde el servicio.</u></i></p>`
    : "";

  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1a1a1a;font-size:14px">
    <p>Adjunto Orden de Compra y código HES para la facturación del servicio.</p>
    <p><b>${orden.numero_oc} / HES ${orden.numero_hes}</b> — ${orden.titulo || ""}</p>
    ${notaUF}
    <p><b><u>Nota: Incluir en referencia de la factura, el número de OC a la que hace referencia y código HES. Sin estos datos no serán procesadas las facturas.</u></b></p>
    <p>Saludos cordiales,</p>
    <p><b>${aprobador.nombre} ${aprobador.apellido}</b><br>
    Dpto. de Facturación<br>
    ${from}<br>
    Av. Américo Vespucio 2680, Piso 11, Conchalí</p>
  </body></html>`;

  const attachments = [];
  if (orden.archivo_oc_url) {
    try {
      const content = await fetchAsBase64(orden.archivo_oc_url);
      attachments.push({ filename: (orden.archivo_oc_nombre || orden.numero_oc + ".pdf"), content });
    } catch (e) { /* si falla el adjunto, se envía igual el correo sin él */ }
  }

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject: asunto, html, attachments }),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error("Resend error " + r.status + ": " + txt);
  }
}
