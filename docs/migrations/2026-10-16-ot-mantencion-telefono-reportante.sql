-- Ejecutado directo en Supabase (apply_migration). Se deja el SQL aqui como
-- registro, siguiendo la convencion del repo.
--
-- Guarda el numero de WhatsApp de quien reporto la incidencia (si vino del
-- bot) para que Andres pueda llamarlo directo desde el menu "Llamar al
-- cliente" sin tener que buscarlo en el catastro.

ALTER TABLE ot_mantencion ADD COLUMN IF NOT EXISTS reportado_telefono text;
