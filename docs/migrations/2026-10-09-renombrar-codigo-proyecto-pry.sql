-- Libera el prefijo "OT" (pasa a ser exclusivo de las OT de mantencion, ver
-- docs/superpowers/specs/2026-10-09-ot-mantencion-fase-a-design.md). El
-- codigo de proyecto de capital cambia de {sigla}OT-{n} a {sigla}-PRY-{n},
-- conservando la sigla distintiva por proyecto (GL, CO, PA/CM/EV...).
-- Ejecutar UNA vez en Supabase (proyecto OCSys) -> SQL Editor -> Run.

begin;

create or replace function public.codigo_proyecto(p_sigla text, p_num integer) returns text
language sql immutable set search_path = public as $$
  select p_sigla || '-PRY-' || lpad(p_num::text, greatest(3, length(p_num::text)), '0')
$$;

-- Dispara el trigger proyectos_codigo_propagar_trg (AFTER UPDATE OF codigo),
-- que recodifica las Tareas (proyecto_ot) solas.
update public.proyectos
   set codigo = codigo_proyecto(sigla, numero_ot)
 where codigo is not null and sigla is not null and numero_ot is not null;

commit;

-- Verificacion (deberia listar GL-PRY-006, PA-PRY-001, etc. y sus tareas con el mismo prefijo):
select codigo, sigla, numero_ot, nombre from proyectos where codigo is not null order by numero_ot;
select codigo, descripcion from proyecto_ot order by codigo;
