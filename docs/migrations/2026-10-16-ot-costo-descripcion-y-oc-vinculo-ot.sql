-- Ejecutado directo en Supabase (apply_migration). Se deja el SQL aqui como
-- registro, siguiendo la convencion del repo.

ALTER TABLE ot_costo ADD COLUMN IF NOT EXISTS descripcion text;
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS ot_mantencion_id uuid REFERENCES ot_mantencion(id);
