-- PA-OC-00364 se creó mal: cada ítem del presupuesto (Sondaje 30m, Provisión
-- de Agua, Movilización, Cierre perimetral OSB, Análisis RQD) quedó como una
-- "cuota" separada, cuando en realidad la forma de pago real es 30%
-- anticipo / 70% saldo sobre el neto total (212,50 UF). Las filas -1 y -2 ya
-- se corrigieron (monto_neto/iva/total recalculados para 30%/70%), pero las
-- filas -3/-4/-5 quedaron sobrando y deben eliminarse por completo.
--
-- Nota: NO sirve marcarlas con activo=false -- el agrupador de cuotas en
-- index.html (ver "ordenesConVisible", comentario "Las OC eliminadas se
-- mezclan con las activas para que queden en su puesto dentro de la
-- numeracion") las vuelve a incluir a propósito en el grupo de hermanos, asi
-- que un soft-delete no las saca de la tabla de cuotas del PDF.
--
-- Herramienta de Claude Code bloqueo el DELETE directo (clasificador de
-- acciones destructivas) -- correr esto a mano en el SQL Editor de Supabase.

delete from ordenes_compra
where numero_oc in ('PA-OC-00364-3', 'PA-OC-00364-4', 'PA-OC-00364-5');
