-- EJECUTAR A MANO en el SQL Editor de Supabase (el clasificador de
-- seguridad de Claude Code bloquea los DELETE masivos sin WHERE).
--
-- Blanquea todas las OT de Mantencion creadas durante las pruebas del
-- modulo (OT-0001 a OT-0022), antes de habilitar el menu "Ordenes de
-- Trabajo" para todos los usuarios @patagonica.cl. Verificado: las 22 OT
-- actuales tienen creado_por_usuario = 'amelendez@patagonica.cl' (ninguna
-- fue creada por otro usuario real ni por un tenant real via WhatsApp/
-- Telegram con su propio numero -- las 2 que parecen venir del bot usan el
-- numero de prueba 56951120146, no el de Andres). Ninguna Orden de Compra
-- (ordenes_compra) esta vinculada a estas OT (ot_mantencion_id IS NOT NULL
-- da 0 filas), asi que esto NO afecta el modulo de Ordenes de Compra.
--
-- Borra primero las tablas dependientes (sin ON DELETE CASCADE) y al final
-- ot_mantencion; reinicia el contador para que la proxima OT real arranque
-- de nuevo en OT-0001.

DELETE FROM ot_bitacora;
DELETE FROM ot_evidencia;
DELETE FROM ot_costo;
DELETE FROM ot_tarea;
DELETE FROM ot_mantencion;
UPDATE contador_ot_mantencion SET ultimo = 0;
