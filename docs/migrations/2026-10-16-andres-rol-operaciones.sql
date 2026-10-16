-- Ejecutado directo en Supabase. Se deja el SQL aqui como registro.
--
-- Marca a Andres como personal de Operaciones (rol_operaciones) para poder
-- filtrar los selectores de "Responsable"/"Patagonica" en OT Mantencion y
-- que solo muestren gente de Operaciones, no todo el que tiene cuenta
-- @patagonica.cl en OCFast (ej. Finanzas, que solo genera OC).

UPDATE usuarios SET rol_operaciones = 'Coordinador' WHERE usuario = 'asanchez@patagonica.cl';
