> Este archivo lo lee Emily (asistente por voz). Actualízalo al cerrar cada avance.
# Estado — OCFast (OCSys)

**Fecha de actualización:** 2026-10-20

## Resumen
App de Órdenes de Compra de Patagónica / Campo Mar / Evox, con menú de Proyectos (gestión tipo CRM) y OT de Mantención. Frontend en un solo `index.html` (React 18 UMD sin build) y funciones serverless en `api/` sobre Supabase.

## Qué funciona
- Menú Órdenes ("Mesa de Control"): columnas plegadas, OT vinculada, columna Duplicar para OC recurrentes, selector Ordenar por, checkbox Generar OT en Nueva OC.
- Menú Proyectos Fase 1 (producción desde 2026-10-08): el proyecto es la OT con código `OT{sigla}-{nnn}` y sub-tareas `OTPA-001-01`; ficha, bitácora, presupuesto en UF (tabla `uf_diaria`).
- OT de Mantención habilitada para todos los usuarios @patagonica.cl; transiciones de estado validadas también en el backend.
- Bot de Telegram para OT de Mantención vía n8n (workflow `UMHa9yRGaaH9JeuL`) y su gemelo de WhatsApp (`smgFtQrjy8vOXiGs`); todo cambio al bot va en ambos.
- Endpoint `andres_evidencia` (foto del trabajo terminado).

## Pendientes / próximos pasos
- Proyectos Fase 2: hitos ponderados, semáforo y dashboard. Fase 3: notificaciones por correo. Fase 4: informe PDF y adjuntos.
- Vincular OC con OT (requiere tocar Nueva OC, fuera de alcance por ahora).
- Validar con el usuario: montos en neto, "Comprometido" excluye Borrador/Pendiente/Anulado/Rechazado, % avance manual.
- Migración pendiente de ejecutar a mano si no se hizo: blanquear OT de prueba (por confirmar).

## Problemas conocidos
- El `apply_migration` de Supabase suele quedar denegado: el usuario ejecuta el SQL a mano en el SQL Editor (SQL en `docs/migrations/`).
- Trabajar solo en el menú indicado; no tocar los demás menús sin pedirlo.
- El Vercel MCP no tiene acceso al equipo: verificar el deploy pidiendo el HTML de ocfast.vercel.app.

## Dónde está (URL de producción, repo, dependencias)
- Repo: github.com/WurfelSPA/OCSys (carpeta local `ocfast`, rama `main`, auto-deploy en Vercel).
- Producción: https://ocfast.vercel.app
- Depende de: Vercel (equipo wurfel-projects), Supabase proyecto OCSys (`kvzcmmcbzlcrvtvfjxaj`), n8n, mindicador.cl (UF).
- Diseños y planes en `docs/superpowers/`.
