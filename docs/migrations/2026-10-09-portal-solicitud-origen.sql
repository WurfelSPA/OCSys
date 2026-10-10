-- Portal de solicitudes para arrendatarios (piloto): distingue las OT creadas
-- por el formulario publico de las creadas internamente, para comparar
-- volumen/calidad entre canales. Aplicado directo en Supabase.
alter table ot_mantencion add column if not exists origen text default 'interno';
