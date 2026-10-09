-- Guarda el nombre de quien solicito y de quien aprobo la OC, para
-- imprimirlos como pie de nota en el PDF ("Solicitado por: ..." /
-- "Aprobado por: ..."). Aplicado directo en Supabase.
alter table ordenes_compra add column if not exists solicitado_por text;
alter table ordenes_compra add column if not exists aprobado_por text;
