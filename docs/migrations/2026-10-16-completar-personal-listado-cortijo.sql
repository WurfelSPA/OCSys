-- Ejecutado directo en Supabase (apply_migration). Se deja el SQL aqui como
-- registro, siguiendo la convencion del repo.
--
-- Carga el listado completo de personal operativo de El Cortijo (16
-- personas, 4 areas) desde Listado_Personal_El_Cortijo.xlsx. Las 3 que ya
-- existian (Jose, Teresa, Susana) se completan con apellido y area; el resto
-- se inserta.

ALTER TABLE personal ADD COLUMN IF NOT EXISTS area text;

UPDATE personal SET apellido = 'Fernández', rol = 'Supervisor de Mantenimiento', area = 'Mantenimiento' WHERE nombre = 'José';
UPDATE personal SET apellido = 'Rueda', rol = 'Supervisora', area = 'Aseo Exterior' WHERE nombre = 'Teresa';
UPDATE personal SET apellido = 'Roco', rol = 'Supervisora', area = 'Aseo Interior' WHERE nombre = 'Susana';

INSERT INTO personal (nombre, apellido, rol, area) VALUES
  ('Gabriel', 'Pérez', 'Maestro Polifuncional', 'Mantenimiento'),
  ('Jonathan', 'De La Fuente', 'Maestro Polifuncional', 'Mantenimiento'),
  ('Ricardo', 'Espinoza', 'Maestro Eléctrico', 'Mantenimiento'),
  ('Marco', 'Guerra', 'Maestro Eléctrico', 'Mantenimiento'),
  ('Domingo', 'Prades', 'Técnico Equipos de Aire Acondicionado', 'Mantenimiento'),
  ('Ricardo', 'Landeros', 'Auxiliar Aseo Exterior', 'Aseo Exterior'),
  ('Hugo', 'Herrera', 'Auxiliar Aseo Exterior', 'Aseo Exterior'),
  ('Héctor', 'Rojas', 'Auxiliar Aseo Exterior', 'Aseo Exterior'),
  ('Miguel', 'Cares', 'Auxiliar Aseo Exterior', 'Aseo Exterior'),
  ('Gladys', 'Santos', 'Auxiliar Aseo Interior', 'Aseo Interior'),
  ('Romina', 'Sanhueza', 'Auxiliar Aseo Interior', 'Aseo Interior'),
  ('Francisco', 'Gómez', 'Conserje AM', 'Conserjería'),
  ('Eduardo', 'Suárez', 'Conserje PM', 'Conserjería');
