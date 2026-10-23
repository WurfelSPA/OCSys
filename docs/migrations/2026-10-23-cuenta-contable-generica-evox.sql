-- Evox (empresa_id=3) solo tenia 1 Cuenta Contable (GASTOS GENERALES, ver
-- migracion 2026-10-23-centro-costo-cuenta-contable-evox.sql). El usuario
-- pidio un listado completo "igual como sale para PISA" -- PISA tiene ~130
-- cuentas, pero la mayoria son especificas de Patagonica (arriendo/venta a
-- arrendatarios de El Cortijo por sitio, provisiones de dividendos a sus
-- inversionistas SpA, terrenos Rapel/La Barbada) y no aplican a Evox.
--
-- Se replicaron solo las ~80 cuentas GENERICAS (bancos, AFP/ISAPRE/IPS/CCAF,
-- IVA, PPM, honorarios, remuneraciones, depreciaciones de activos genericos,
-- gastos generales, etc.), con el mismo codigo y descripcion que usa PISA,
-- bajo el centro de costo propio de Evox (000006). Confirmado con el usuario
-- (opcion "Solo las genericas") antes de ejecutar.
--
-- NOTA: esta migracion ya se ejecuto directamente via Supabase MCP (sesion
-- del 2026-10-23) -- este archivo es solo el registro, no hace falta
-- correrlo de nuevo (el INSERT fallaria por violar la clave unica
-- (codigo, centro_costo_codigo) si se intenta repetir).

insert into cuentas_contables (codigo, descripcion, centro_costo_codigo, activo, empresa_id) values
('21050200100','AFP POR PAGAR (Gral)','000006',true,3),
('42030200500','AJUSTES POR REDONDEO (Gral)','000006',true,3),
('53030200400','AJUSTES POR REDONDEO PERDIDAS (Gral)','000006',true,3),
('13030910200','AMORTIZ. IMPLEMENT.SOFTWARE (Gral)','000006',true,3),
('11070300100','ANTICIPO DE PROVEEDORES (Gral)','000006',true,3),
('11070100100','ANTICIPO DE REMUNERACIONES (Gral)','000006',true,3),
('52030100100','ASESORIAS (Gral)','000006',true,3),
('11010200100','BANCO CHILE $$ (Gral)','000006',true,3),
('11010200200','BANCO SANTANDER $$ (Gral)','000006',true,3),
('23010100300','CAPITAL PAGADO (Gral)','000006',true,3),
('21050200400','CCAF POR PAGAR (Gral)','000006',true,3),
('21030100200','CHEQUES GIRADOS Y NO COBRADOS (Gral)','000006',true,3),
('11040200100','CHEQUES POR COBRAR (Gral)','000006',true,3),
('53020100300','COMISIONES Y GTOS. BANCARIOS (Gral)','000006',true,3),
('42030200400','CORRECCION MONETARIA ACTIVOS (Gral)','000006',true,3),
('53030200300','CORRECCION MONETARIA PASIVOS (Gral)','000006',true,3),
('53030200500','CORRECION MONETARIA CAPITAL PROPIO (General) (Gral)','000006',true,3),
('11090200400','CREDITO LEY AUSTRAL (Gral)','000006',true,3),
('12093100300','DEP. ACUM. EQUIPOS COMPUTACIONALES (Gral)','000006',true,3),
('12093200200','DEP. ACUM. EQUIPOS PARA LA CONSTRUCCION (Gral)','000006',true,3),
('12093500100','DEP. ACUM. EQUIPOS VIGILANCIA (Gral)','000006',true,3),
('12093200300','DEP. ACUM. HERRAMIENTAS (Gral)','000006',true,3),
('12093100600','DEP. ACUM. INSTALACIONES (Gral)','000006',true,3),
('12093200100','DEP. ACUM. MAQUINARIAS (Gral)','000006',true,3),
('12093100200','DEP. ACUM. MUEBLES DE OFICINA (Gral)','000006',true,3),
('12093300100','DEP. ACUM. VEHICULOS (Gral)','000006',true,3),
('52043100300','DEPRECIACION EQUIPOS COMPUTACIONALES (Gral)','000006',true,3),
('52043500100','DEPRECIACION EQUIPOS VIGILANCIA (Gral)','000006',true,3),
('52043200300','DEPRECIACION HERRAMIENTAS (Gral)','000006',true,3),
('52043200100','DEPRECIACION MAQUINARIAS (Gral)','000006',true,3),
('42030200100','DIF. VARIACION U.F.GANANCIAS (Gral)','000006',true,3),
('53030200100','DIF. VARIACION U.F.PERDIDAS (Gral)','000006',true,3),
('12030100300','EQUIPOS COMPUTACIONALES (Gral)','000006',true,3),
('12030200200','EQUIPOS PARA LA CONSTRUCCION (Gral)','000006',true,3),
('12030500100','EQUIPOS VIGILANCIA (Gral)','000006',true,3),
('11040100200','FACTURAS EN COBRANZA (Gral)','000006',true,3),
('11040100300','FACTURAS EN COBRANZA EXTERNA (Gral)','000006',true,3),
('11040100100','FACTURAS POR COBRAR (Gral)','000006',true,3),
('21020100100','FACTURAS POR PAGAR NACIONAL (Gral)','000006',true,3),
('11030100100','FONDOS MUTUOS BANCHILE (Gral)','000006',true,3),
('42020100300','GANANCIA (PERD) RESCATE FFMM (Gral)','000006',true,3),
('13030300100','GARANTIAS ENTREGADAS (Gral)','000006',true,3),
('21080100100','GARANTIAS RECIBIDAS (Gral)','000006',true,3),
('12030200300','HERRAMIENTAS (Gral)','000006',true,3),
('52030100200','HONORARIOS (Gral)','000006',true,3),
('21020200100','HONORARIOS POR PAGAR (Gral)','000006',true,3),
('13030100200','IMPLEMETAC. SOFTWARE (Gral)','000006',true,3),
('21050100200','IMPTO. 2DA. CATEGORIA (Gral)','000006',true,3),
('21070200100','IMPUESTO RENTA POR PAGAR (Gral)','000006',true,3),
('21050100100','IMPUESTO UNICO AL TRABAJADOR (Gral)','000006',true,3),
('12030100600','INSTALACIONES (Gral)','000006',true,3),
('21060690000','INTERESES POR PAGAR CTA.CTE.C.INT.UF (Gral)','000006',true,3),
('53020100200','INTERESES POR PTMOS. EN U.F. (Gral)','000006',true,3),
('21050200300','IPS POR PAGAR (Gral)','000006',true,3),
('21050200200','ISAPRES POR PAGAR (Gral)','000006',true,3),
('11090100100','IVA CREDITO FISCAL (Gral)','000006',true,3),
('21070100100','IVA DEBITO FISCAL (Gral)','000006',true,3),
('12030100500','LINEAS TELEFONICAS (Gral)','000006',true,3),
('12030200100','MAQUINARIAS (Gral)','000006',true,3),
('12030100200','MUEBLES DE OFICINA (Gral)','000006',true,3),
('21050200500','MUTUAL POR PAGAR (Gral)','000006',true,3),
('11070900100','OTRAS CUENTAS POR COBRAR (Gral)','000006',true,3),
('52030100600','PATENTES (Gral)','000006',true,3),
('11090200100','PPM (Gral)','000006',true,3),
('21070200200','PPM POR PAGAR (Gral)','000006',true,3),
('11090200600','PPM POR RECUPERAR (Gral)','000006',true,3),
('11070100200','PRESTAMOS AL PERSONAL (Gral)','000006',true,3),
('42030200300','REAJUSTES GANADOS (Gral)','000006',true,3),
('52030101000','REMUNERACIONES (Gral)','000006',true,3),
('21050200800','REMUNERACIONES POR PAGAR (Gral)','000006',true,3),
('23020100200','RESULTADO ACUMULADO (Gral)','000006',true,3),
('23020200100','RESULTADOS DEL EJERCICIO (Gral)','000006',true,3),
('23010200200','REVALOR. C.P.I. CAPITAL (Gral)','000006',true,3),
('23010200300','REVALOR. C.P.I. RES. ACUM. (Gral)','000006',true,3),
('52030101100','SEGURO COMPLEMENTARIO (Gral)','000006',true,3),
('52030100900','SEGUROS PAGADOS (Gral)','000006',true,3),
('41010600600','SERVICIOS DE ADMINISTRACION (Gral)','000006',true,3),
('41010600500','SERVICIOS PRESTADOS (Gral)','000006',true,3),
('21020100500','TARJETA DE CREDITO POR PAGAR (Gral)','000006',true,3),
('12030300100','VEHICULOS (Gral)','000006',true,3);

update cuentas_contables set descripcion = 'GASTOS GENERALES (Gral)'
where codigo='52030100700' and centro_costo_codigo='000006' and empresa_id=3;
