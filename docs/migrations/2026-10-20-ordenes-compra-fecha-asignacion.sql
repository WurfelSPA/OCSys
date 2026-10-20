-- Ejecutado via apply_migration (mcp Supabase). Se deja el SQL aqui como
-- registro, siguiendo la convencion del repo.
--
-- La columna no existia -- el spec/plan de "OC en cuotas: fila unica con
-- chips de aprobacion" (docs/superpowers/specs/2026-10-20-cuotas-fila-unica-design.md)
-- asumio por error que ya se guardaba (se confundio con ot_mantencion.fecha_asignacion,
-- una tabla distinta). La detecto la revision final de codigo de ese feature:
-- sin esta columna, el tooltip de "emitida DD-MM-YYYY" y la columna "Fecha
-- Emision" del PDF consolidado nunca mostraban una fecha real.
--
-- api/ordenes.js debe setear este campo (junto a aprobado_por/numero_hes)
-- cuando body.estado === "Aprobada".

alter table public.ordenes_compra add column if not exists fecha_asignacion timestamptz;
