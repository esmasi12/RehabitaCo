-- ════════════════════════════════════════════════════════════
--  RehabitaCo — Migración v3: fotos con etapa, archivos adjuntos,
--  análisis de estado por IA. Idempotente (se puede ejecutar 2 veces).
--  supabase.com → SQL Editor → New query
-- ════════════════════════════════════════════════════════════

-- Columnas que ya usa la app en proyectos (por si faltara alguna)
alter table public.proyectos
  add column if not exists comunidad_autonoma text,
  add column if not exists precio_venta numeric(12,2),
  add column if not exists precio_venta_real numeric(12,2),
  add column if not exists fecha_venta date,
  add column if not exists mobiliario numeric(12,2),
  add column if not exists gastos_compra_extra numeric(12,2),
  add column if not exists gastos_venta_extra numeric(12,2),
  add column if not exists hipoteca_importe numeric(12,2),
  add column if not exists hipoteca_plazo numeric(5,2),
  add column if not exists hipoteca_interes numeric(6,4),
  add column if not exists alquiler_mensual numeric(10,2),
  add column if not exists gastos_anuales_alq numeric(10,2),
  add column if not exists revalorizacion_anual numeric(6,4);

-- ── Fotos ────────────────────────────────────────────────────
create table if not exists public.proyecto_fotos (
  id          uuid primary key default uuid_generate_v4(),
  proyecto_id uuid not null references public.proyectos(id) on delete cascade,
  url         text not null,
  path        text,
  orden       integer not null default 0,
  created_by  uuid references public.perfiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table public.proyecto_fotos
  add column if not exists etapa text check (etapa in ('antes','durante','despues')),
  add column if not exists estancia text,
  add column if not exists nota text;

-- ── Archivos adjuntos (contratos, escrituras, licencias, facturas…) ──
create table if not exists public.proyecto_archivos (
  id          uuid primary key default uuid_generate_v4(),
  proyecto_id uuid not null references public.proyectos(id) on delete cascade,
  nombre      text not null,
  path        text not null,
  categoria   text not null default 'otro',
  mime        text,
  size_bytes  bigint,
  nota        text,
  created_by  uuid references public.perfiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_archivos_proyecto on public.proyecto_archivos(proyecto_id);

-- ── Análisis de estado (visión IA) ───────────────────────────
create table if not exists public.proyecto_analisis_estado (
  id            uuid primary key default uuid_generate_v4(),
  proyecto_id   uuid not null references public.proyectos(id) on delete cascade,
  puntuacion    integer check (puntuacion between 0 and 100),
  nivel         text,
  confianza     numeric(3,2),
  reforma_min   numeric(12,2),
  reforma_max   numeric(12,2),
  informe       jsonb not null default '{}',
  foto_ids      uuid[] not null default '{}',
  proveedor     text,
  modelo        text,
  created_by    uuid references public.perfiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_analisis_proyecto on public.proyecto_analisis_estado(proyecto_id, created_at desc);

-- ── RLS ──────────────────────────────────────────────────────
alter table public.proyecto_fotos            enable row level security;
alter table public.proyecto_archivos         enable row level security;
alter table public.proyecto_analisis_estado  enable row level security;

drop policy if exists "fotos_all_v3" on public.proyecto_fotos;
create policy "fotos_all_v3" on public.proyecto_fotos for all
  using (public.es_activo()) with check (public.es_activo());
drop policy if exists "archivos_all_v3" on public.proyecto_archivos;
create policy "archivos_all_v3" on public.proyecto_archivos for all
  using (public.es_activo()) with check (public.es_activo());
drop policy if exists "analisis_all_v3" on public.proyecto_analisis_estado;
create policy "analisis_all_v3" on public.proyecto_analisis_estado for all
  using (public.es_activo()) with check (public.es_activo());

-- ── Storage ──────────────────────────────────────────────────
-- Fotos: bucket público (las URLs son difíciles de adivinar, pero son públicas).
-- Archivos: bucket PRIVADO (se descargan con URL firmada temporal).
insert into storage.buckets (id, name, public, file_size_limit) values
  ('proyecto-fotos',    'proyecto-fotos',    true,  10485760),
  ('proyecto-archivos', 'proyecto-archivos', false, 52428800)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

drop policy if exists "storage_fotos_v3" on storage.objects;
create policy "storage_fotos_v3" on storage.objects for all
  using (bucket_id = 'proyecto-fotos' and public.es_activo())
  with check (bucket_id = 'proyecto-fotos' and public.es_activo());
drop policy if exists "storage_archivos_v3" on storage.objects;
create policy "storage_archivos_v3" on storage.objects for all
  using (bucket_id = 'proyecto-archivos' and public.es_activo())
  with check (bucket_id = 'proyecto-archivos' and public.es_activo());

-- Verificación
select table_name from information_schema.tables
where table_schema='public' and table_name in ('proyecto_fotos','proyecto_archivos','proyecto_analisis_estado');
