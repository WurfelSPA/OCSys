// Reparte el monto (neto/iva) de una OC entre sus N cuotas y arma los campos
// que le corresponden a cada fila cuando se divide en cuotas independientes
// (ver docs/superpowers/specs/2026-09-29-ordenes-en-cuotas-design.md). El IVA
// se reparte proporcionalmente al neto de cada cuota (no siempre es 19% --
// una OC "Exento" puede traer monto_iva=0), y la ultima cuota se lleva el
// resto del redondeo para que la suma de las N filas de exacto el total
// original, nunca mas ni menos por un centavo perdido en el redondeo.
export function calcularFilasCuotas({ cuotas, montoNeto, montoIva, numeroBase }) {
  const netoTotal = Number(montoNeto) || 0;
  const ivaTotal = Number(montoIva) || 0;
  let ivaAcumulado = 0;

  return cuotas.map((c, i) => {
    const esUltima = i === cuotas.length - 1;
    const montoNetoCuota = Number(c.monto) || 0;
    const montoIvaCuota = esUltima
      ? ivaTotal - ivaAcumulado
      : Math.round(netoTotal ? (montoNetoCuota / netoTotal) * ivaTotal : 0);
    ivaAcumulado += montoIvaCuota;

    return {
      numero_oc: numeroBase + "-" + (i + 1),
      monto_neto: montoNetoCuota,
      monto_iva: montoIvaCuota,
      monto_total: montoNetoCuota + montoIvaCuota,
      cuota_numero: i + 1,
      cuota_total: cuotas.length,
    };
  });
}
