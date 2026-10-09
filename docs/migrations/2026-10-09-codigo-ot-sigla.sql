-- Proyectos: codigo OT + sigla + correlativo unico global (ej. OTGL-006) y
-- tareas = codigo del proyecto + '-' + nn (ej. OTPA-001-01).
-- Ejecutar UNA vez en Supabase (proyecto OCSys) -> SQL Editor -> Run.
-- Es transaccional: si algo falla, no queda nada a medias.

begin;

alter table public.proyectos
  add column if not exists sigla text,
  add column if not exists ultimo_ot integer not null default 0,
  add column if not exists numero_ot integer;
alter table public.proyectos
  add constraint proyectos_sigla_chk check (sigla is null or sigla ~ '^[A-Z]{2,4}$');

create table public.contador_proyectos_ot (
  id boolean primary key default true check (id),
  ultimo integer not null default 0
);
insert into public.contador_proyectos_ot (id, ultimo) values (true, 0);
alter table public.contador_proyectos_ot enable row level security;

-- Sigla sugerida: 2 primeras letras de la primera palabra "distintiva" del
-- nombre (Glamping -> GL, Remodelacion El Cortijo -> CO, Edificio 57 -> ED).
create or replace function public.sugerir_sigla_proyecto(p_nombre text) returns text
language plpgsql immutable set search_path = public as $$
declare v text; w text;
  stop text[] := array['EL','LA','LOS','LAS','DE','DEL','Y','EN','AL','UN','UNA','PROYECTO','OBRA','OBRAS',
                       'REMODELACION','HABILITACION','MANTENCION','CONSTRUCCION','INSTALACION','AMPLIACION','REPARACION','MEJORAMIENTO'];
begin
  v := upper(translate(coalesce(p_nombre, ''), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'));
  foreach w in array regexp_split_to_array(v, '[^A-Z0-9]+') loop
    if length(w) >= 2 and w ~ '^[A-Z]' and not (w = any(stop)) then
      return substr(w, 1, 2);
    end if;
  end loop;
  v := regexp_replace(v, '[^A-Z]', '', 'g');
  return case when length(v) >= 2 then substr(v, 1, 2) else 'PR' end;
end $$;

drop trigger if exists proyectos_codigo_trg on public.proyectos;
drop trigger if exists proyecto_ot_codigo_trg on public.proyecto_ot;
drop function if exists public.asignar_codigo_proyecto();
drop function if exists public.asignar_codigo_ot();
drop table if exists public.contadores_proyecto;

create or replace function public.codigo_proyecto(p_sigla text, p_num integer) returns text
language sql immutable set search_path = public as $$
  select 'OT' || p_sigla || '-' || lpad(p_num::text, greatest(3, length(p_num::text)), '0')
$$;

-- Insert: asigna numero global + sigla (sugerida si no viene) + codigo.
create or replace function public.proyectos_codigo_ins() returns trigger
language plpgsql set search_path = public as $$
begin
  if lower(trim(new.nombre)) = 'contenedor' then
    return new;
  end if;
  if new.sigla is null then new.sigla := sugerir_sigla_proyecto(new.nombre); end if;
  update contador_proyectos_ot set ultimo = ultimo + 1 where id returning ultimo into new.numero_ot;
  new.codigo := codigo_proyecto(new.sigla, new.numero_ot);
  return new;
end $$;

-- Update de sigla: recalcula el codigo (mismo numero).
create or replace function public.proyectos_codigo_upd() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.numero_ot is not null and new.sigla is distinct from old.sigla then
    if new.sigla is null then new.sigla := old.sigla; end if;
    new.codigo := codigo_proyecto(new.sigla, new.numero_ot);
  end if;
  return new;
end $$;

-- Si cambia el codigo del proyecto, las tareas arrastran el nuevo prefijo.
create or replace function public.proyectos_codigo_propagar() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.codigo is distinct from old.codigo and old.codigo is not null then
    update proyecto_ot set codigo = new.codigo || substr(codigo, length(old.codigo) + 1)
     where proyecto_id = new.id and codigo like old.codigo || '-%';
  end if;
  return null;
end $$;

-- Tareas: codigo del proyecto + '-' + correlativo dentro del proyecto.
create or replace function public.proyecto_ot_codigo_ins() returns trigger
language plpgsql set search_path = public as $$
declare v_num integer; v_cod text;
begin
  if new.codigo is null then
    update proyectos set ultimo_ot = ultimo_ot + 1 where id = new.proyecto_id returning ultimo_ot, codigo into v_num, v_cod;
    new.codigo := v_cod || '-' || lpad(v_num::text, greatest(2, length(v_num::text)), '0');
  end if;
  return new;
end $$;

-- Renumerar lo existente (Mantencion General primero), antes de crear los
-- triggers de update para no recodificar dos veces.
do $$
declare r record; n integer := 0; t record; k integer; v_cod text; v_sig text;
begin
  for r in
    select p.id, p.nombre, p.es_permanente, e.codigo as emp
      from proyectos p join empresas e on e.id = p.empresa_id
     where p.codigo is not null
     order by (not p.es_permanente), p.empresa_id, p.created_at
  loop
    n := n + 1;
    v_sig := case when r.es_permanente then r.emp else sugerir_sigla_proyecto(r.nombre) end;
    v_cod := codigo_proyecto(v_sig, n);
    update proyectos set numero_ot = n, sigla = v_sig, codigo = v_cod where id = r.id;
    k := 0;
    for t in select id from proyecto_ot where proyecto_id = r.id order by created_at, codigo loop
      k := k + 1;
      update proyecto_ot set codigo = v_cod || '-' || lpad(k::text, 2, '0') where id = t.id;
    end loop;
    update proyectos set ultimo_ot = k where id = r.id;
  end loop;
  update contador_proyectos_ot set ultimo = n where id;
end $$;

create trigger proyectos_codigo_ins_trg before insert on public.proyectos
  for each row execute function public.proyectos_codigo_ins();
create trigger proyectos_codigo_upd_trg before update of sigla on public.proyectos
  for each row execute function public.proyectos_codigo_upd();
create trigger proyectos_codigo_propagar_trg after update of codigo, sigla on public.proyectos
  for each row execute function public.proyectos_codigo_propagar();
create trigger proyecto_ot_codigo_ins_trg before insert on public.proyecto_ot
  for each row execute function public.proyecto_ot_codigo_ins();

revoke execute on function public.proyectos_codigo_ins(), public.proyectos_codigo_upd(),
  public.proyectos_codigo_propagar(), public.proyecto_ot_codigo_ins() from public, anon, authenticated;

alter table public.proyectos add constraint proyectos_numero_ot_key unique (numero_ot);

commit;

-- Verificacion (deberia listar OTPA-001 ... OTCA-007 y OTPA-001-01..03):
select codigo, sigla, numero_ot, nombre from proyectos where codigo is not null order by numero_ot;
select codigo, descripcion from proyecto_ot order by codigo;
