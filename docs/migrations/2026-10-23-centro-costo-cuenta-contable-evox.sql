-- Evox (empresa_id = 3) no tenia NINGUN Centro de Costo ni Cuenta Contable
-- propios -- por eso en Nueva OC, al elegir esa empresa, el desplegable de
-- Centro de Costo salia vacio y no se podia crear ninguna OC para Evox.
--
-- Valores puestos aqui como default razonable (siguiendo el patron de las
-- otras empresas: un centro de costo generico con el mismo nombre de la
-- empresa, mas una cuenta "GASTOS GENERALES" reutilizando el mismo codigo
-- que ya usa Patagonica para eso) -- si el codigo contable real que usa el
-- contador de Evox es otro, renombrar/corregir esta fila despues, no hace
-- falta rehacer la migracion.
--
-- No se pudo ejecutar directo porque el MCP de Supabase de esta sesion
-- necesitaba reautenticarse -- correr esto a mano en el SQL Editor.

insert into centros_costo (codigo, descripcion, activo, empresa_id)
values ('000006', 'EVOX', true, 3);

insert into cuentas_contables (codigo, descripcion, centro_costo_codigo, activo, empresa_id)
values ('52030100700', 'GASTOS GENERALES', '000006', true, 3);
