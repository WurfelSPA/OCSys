-- Esquema completo Fase A del nuevo modulo "OT Mantencion" (ver
-- docs/superpowers/specs/2026-10-09-ot-mantencion-fase-a-design.md). Todo
-- nuevo/aditivo, no toca tablas existentes salvo ADD COLUMN.
-- Ejecutar UNA vez en Supabase (proyecto OCSys) -> SQL Editor -> Run.

begin;

-- ===== Columnas nuevas en tablas existentes =====

alter table public.proveedores add column if not exists rubro text;

alter table public.usuarios
  add column if not exists rol_operaciones text,
  add column if not exists especialidad text;
alter table public.usuarios drop constraint if exists usuarios_rol_operaciones_chk;
alter table public.usuarios add constraint usuarios_rol_operaciones_chk
  check (rol_operaciones is null or rol_operaciones in ('Coordinador','Técnico','Administración','Gerencia'));

alter table public.centros_costo add column if not exists presupuesto_asignado_uf numeric;

-- ===== Catalogo de ubicaciones =====

create table public.sitio (
  id uuid primary key default gen_random_uuid(),
  empresa_id integer not null references public.empresas(id),
  codigo text not null,
  nombre text not null,
  direccion text,
  rol_sii text,
  superficie_terreno_m2 numeric,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, codigo)
);

create table public.edificio (
  id uuid primary key default gen_random_uuid(),
  sitio_id uuid not null references public.sitio(id),
  codigo text not null,
  nombre text not null,
  direccion text,
  pisos integer,
  alias text[] not null default '{}',
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sitio_id, codigo)
);

create table public.unidad (
  id uuid primary key default gen_random_uuid(),
  sitio_id uuid not null references public.sitio(id),
  edificio_id uuid not null references public.edificio(id),
  codigo text not null unique,
  nombre text,
  tipo text check (tipo in ('Bodega','Oficina','Local comercial','Espacio-terreno','Estacionamiento','Antena-uso técnico')),
  piso integer,
  superficie_m2 numeric,
  estado text not null default 'Ocupada' check (estado in ('Ocupada','Vacante','En remodelación','De baja')),
  alias text[] not null default '{}',
  vigente_desde date,
  vigente_hasta date,
  unidades_origen uuid[] not null default '{}',
  plano_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.area_comun (
  id uuid primary key default gen_random_uuid(),
  sitio_id uuid references public.sitio(id),
  edificio_id uuid references public.edificio(id),
  codigo text not null unique,
  nombre text not null,
  unidades_que_atiende uuid[] not null default '{}',
  alias text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===== Cliente / Contrato (operaciones de mantencion) =====

create table public.cliente_operaciones (
  id uuid primary key default gen_random_uuid(),
  rut text not null unique,
  razon_social text not null,
  nombre_fantasia text,
  giro text,
  dominios_correo text[] not null default '{}',
  estado text not null default 'Activo' check (estado in ('Activo','Ex-cliente','Prospecto')),
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.contacto_operaciones (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.cliente_operaciones(id),
  nombre text not null,
  cargo text,
  correo text,
  telefono text,
  rol text[] not null default '{}',
  principal_operaciones boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.contrato_operaciones (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  cliente_id uuid not null references public.cliente_operaciones(id),
  fecha_inicio date not null,
  fecha_termino date,
  renta_uf numeric,
  gastos_comunes_uf numeric,
  garantia_tipo text,
  garantia_monto numeric,
  garantia_vencimiento date,
  seguro_arrendatario_vencimiento date,
  clausula_mantencion text,
  sla_respuesta_horas numeric,
  sla_solucion_dias numeric,
  horario_acceso text,
  uso_compartido boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.contrato_unidad (
  id uuid primary key default gen_random_uuid(),
  contrato_id uuid not null references public.contrato_operaciones(id),
  unidad_id uuid not null references public.unidad(id),
  desde date not null,
  hasta date,
  created_at timestamptz not null default now()
);

-- ===== La OT de mantencion =====

create table public.contador_ot_mantencion (
  id boolean primary key default true check (id),
  ultimo integer not null default 0
);
insert into public.contador_ot_mantencion (id, ultimo) values (true, 0);

create or replace function public.siguiente_numero_ot() returns integer
language plpgsql set search_path = public as $$
declare v integer;
begin
  update contador_ot_mantencion set ultimo = ultimo + 1 where id returning ultimo into v;
  return v;
end $$;

create table public.ot_mantencion (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  empresa_id integer not null references public.empresas(id),
  titulo text not null,
  resumen text,
  elemento_afectado text,
  categoria text,
  subcategoria text,
  ubicacion_tipo text check (ubicacion_tipo in ('unidad','edificio','sitio','area_comun')),
  ubicacion_id uuid,
  ubicaciones_adicionales uuid[] not null default '{}',
  clientes_afectados uuid[] not null default '{}',
  contratos_afectados uuid[] not null default '{}',
  impacto text check (impacto in ('Seguridad de personas','Operación detenida','Operación afectada','Sin impacto operativo')),
  urgencia text check (urgencia in ('En curso','Estable')),
  prioridad text check (prioridad in ('P1','P2','P3','P4')),
  prioridad_motivo_cambio text,
  estado text not null default 'Nueva' check (estado in ('Nueva','Asignada','En curso','En espera','Resuelta','Cerrada','Anulada')),
  motivo_espera text check (motivo_espera in ('Proveedor','Materiales','Cotización','Aprobación de gasto','Acceso del cliente','Clima')),
  responsable_id uuid references public.usuarios(id),
  ejecutor_tipo text check (ejecutor_tipo in ('interno','proveedor')),
  ejecutor_proveedor_id uuid references public.proveedores(id),
  ejecutor_interno text,
  centro_costo_codigo text,
  fecha_limite_respuesta timestamptz,
  fecha_limite_solucion timestamptz,
  contencion_realizada timestamptz,
  fecha_asignacion timestamptz,
  fecha_inicio timestamptz,
  fecha_resolucion timestamptz,
  fecha_cierre timestamptz,
  solucion text,
  costo_estimado numeric,
  costo_real numeric,
  cargo text check (cargo in ('Arrendador','Arrendatario','Compartido','Seguro','Garantía','Por definir')),
  cargo_compartido_pct numeric,
  recuperable_monto numeric,
  aprobacion_gasto_usuario uuid references public.usuarios(id),
  aprobacion_gasto_fecha timestamptz,
  reaperturas integer not null default 0,
  etiquetas text[] not null default '{}',
  reportado_por text,
  fecha_reporte timestamptz,
  descripcion_original text,
  creado_por_usuario text,
  activo boolean not null default true,
  eliminado_por text,
  eliminado_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ot_tarea (
  id uuid primary key default gen_random_uuid(),
  ot_id uuid not null references public.ot_mantencion(id),
  descripcion text not null,
  responsable_id uuid references public.usuarios(id),
  estado text not null default 'pendiente' check (estado in ('pendiente','hecha')),
  fecha date,
  created_at timestamptz not null default now()
);

create table public.ot_evidencia (
  id uuid primary key default gen_random_uuid(),
  ot_id uuid not null references public.ot_mantencion(id),
  archivo_url text not null,
  archivo_nombre text,
  tipo text check (tipo in ('antes','durante','después','documento','factura')),
  autor_usuario text,
  created_at timestamptz not null default now()
);

create table public.ot_costo (
  id uuid primary key default gen_random_uuid(),
  ot_id uuid not null references public.ot_mantencion(id),
  concepto text check (concepto in ('materiales','mano de obra','proveedor','otro')),
  monto_clp numeric not null,
  proveedor_id uuid references public.proveedores(id),
  numero_factura_boleta text,
  fecha date,
  created_at timestamptz not null default now()
);

create table public.ot_bitacora (
  id uuid primary key default gen_random_uuid(),
  ot_id uuid not null references public.ot_mantencion(id),
  tipo text not null default 'comentario' check (tipo in ('comentario','sistema')),
  texto text not null,
  usuario text,
  created_at timestamptz not null default now()
);

-- ===== RLS (activado sin politicas -- la API usa la service role key) =====

alter table public.sitio enable row level security;
alter table public.edificio enable row level security;
alter table public.unidad enable row level security;
alter table public.area_comun enable row level security;
alter table public.cliente_operaciones enable row level security;
alter table public.contacto_operaciones enable row level security;
alter table public.contrato_operaciones enable row level security;
alter table public.contrato_unidad enable row level security;
alter table public.contador_ot_mantencion enable row level security;
alter table public.ot_mantencion enable row level security;
alter table public.ot_tarea enable row level security;
alter table public.ot_evidencia enable row level security;
alter table public.ot_costo enable row level security;
alter table public.ot_bitacora enable row level security;

commit;
