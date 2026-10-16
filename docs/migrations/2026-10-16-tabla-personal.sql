-- Ejecutado directo en Supabase (apply_migration). Se deja el SQL aqui como
-- registro, siguiendo la convencion del repo.
--
-- "Personal" es el equipo de campo de Andres (mantencion, aseo, etc.) que no
-- tiene ni necesita cuenta de login en OCFast -- separado de "usuarios"
-- (que son cuentas reales con acceso al sistema).

CREATE TABLE IF NOT EXISTS personal (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  apellido text,
  rol text,
  telefono text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

ALTER TABLE ot_mantencion ADD COLUMN IF NOT EXISTS personal_id uuid REFERENCES personal(id);

INSERT INTO personal (nombre, rol) VALUES
  ('José', 'Mantenimiento'),
  ('Teresa', 'Aseo exterior'),
  ('Susana', 'Aseo interior');
