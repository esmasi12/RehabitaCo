-- ════════════════════════════════════════════════════════════
--  RehabitaCo — Supabase Schema
--  Ejecuta este SQL en: supabase.com → SQL Editor → New query
-- ════════════════════════════════════════════════════════════

-- ── Extensiones ──────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── Tabla: perfiles (vinculada a auth.users de Supabase) ─────
create table if not exists public.perfiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nombre      text not null,
  rol         text not null default 'operario' check (rol in ('admin','encargado','operario')),
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ── Tabla: proyectos ─────────────────────────────────────────
create table if not exists public.proyectos (
  id          uuid primary key default uuid_generate_v4(),
  nombre      text not null,
  direccion   text not null default '—',
  tipo        text not null default 'reforma' check (tipo in ('reforma','nueva','rehab','alquiler')),
  estado      text not null default 'neg'     check (estado in ('neg','ref','act','fin')),
  precio      numeric(12,2) not null default 0,
  reforma     numeric(12,2) not null default 0,
  m2          numeric(8,2),
  inicio      date,
  fin_est     date,
  notas       text,
  emoji       text not null default '🏠',
  thumb       text not null default 'thumb-gold',
  created_by  uuid references public.perfiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── Tabla: fases_plantilla ───────────────────────────────────
create table if not exists public.fases_plantilla (
  id          uuid primary key default uuid_generate_v4(),
  nombre      text not null,
  descripcion text,
  sector      text not null check (sector in ('legal','arq','obra','elect','font','dis')),
  orden       integer not null default 0,
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ── Tabla: proyecto_fases (fases completadas por proyecto) ───
create table if not exists public.proyecto_fases (
  id          uuid primary key default uuid_generate_v4(),
  proyecto_id uuid not null references public.proyectos(id) on delete cascade,
  fase_id     uuid not null references public.fases_plantilla(id) on delete cascade,
  done        boolean not null default false,
  done_at     timestamptz,
  done_by     uuid references public.perfiles(id) on delete set null,
  unique (proyecto_id, fase_id)
);

-- ── Tabla: gastos ────────────────────────────────────────────
create table if not exists public.gastos (
  id          uuid primary key default uuid_generate_v4(),
  proyecto_id uuid not null references public.proyectos(id) on delete cascade,
  concepto    text not null,
  sector      text not null default 'obra' check (sector in ('legal','arq','obra','elect','font','dis')),
  personal    text,
  material    text,
  coste       numeric(10,2) not null default 0,
  fecha       date,
  notas       text,
  created_by  uuid references public.perfiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- ── Tabla: notas_rapidas ─────────────────────────────────────
create table if not exists public.notas_rapidas (
  id            uuid primary key default uuid_generate_v4(),
  proyecto_id   uuid references public.proyectos(id) on delete set null,
  texto         text not null,
  categorias    text[] not null default '{}',
  fase          text,
  importe       numeric(10,2),
  urgente       boolean not null default false,
  prioridad     text not null default 'media' check (prioridad in ('alta','media','baja')),
  fase_vinc_id  uuid references public.fases_plantilla(id) on delete set null,
  done          boolean not null default false,
  done_at       timestamptz,
  created_by    uuid references public.perfiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

-- ── Tabla: contactos ─────────────────────────────────────────
create table if not exists public.contactos (
  id          uuid primary key default uuid_generate_v4(),
  nombre      text not null,
  empresa     text,
  sector      text default 'otro',
  telefono    text,
  email       text,
  notas       text,
  created_by  uuid references public.perfiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- ── Tabla: notas_texto (notas libres por proyecto) ───────────
create table if not exists public.notas_texto (
  id          uuid primary key default uuid_generate_v4(),
  proyecto_id uuid not null references public.proyectos(id) on delete cascade,
  texto       text not null,
  created_by  uuid references public.perfiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- ════════════════════════════════════════════════════════════
--  ROW LEVEL SECURITY (RLS)
-- ════════════════════════════════════════════════════════════

alter table public.perfiles        enable row level security;
alter table public.proyectos       enable row level security;
alter table public.fases_plantilla enable row level security;
alter table public.proyecto_fases  enable row level security;
alter table public.gastos          enable row level security;
alter table public.notas_rapidas   enable row level security;
alter table public.contactos       enable row level security;
alter table public.notas_texto     enable row level security;

-- Helper: ¿el usuario activo es admin?
create or replace function public.es_admin()
returns boolean language sql security definer as $$
  select exists (
    select 1 from public.perfiles
    where id = auth.uid() and rol = 'admin' and activo = true
  );
$$;

-- Helper: ¿el usuario está activo?
create or replace function public.es_activo()
returns boolean language sql security definer as $$
  select exists (
    select 1 from public.perfiles
    where id = auth.uid() and activo = true
  );
$$;

-- Perfiles: cada uno ve el suyo; admin ve todos
create policy "perfiles_select" on public.perfiles for select
  using (id = auth.uid() or public.es_admin());
create policy "perfiles_insert" on public.perfiles for insert
  with check (id = auth.uid());
create policy "perfiles_update" on public.perfiles for update
  using (id = auth.uid() or public.es_admin());
create policy "perfiles_delete" on public.perfiles for delete
  using (public.es_admin());

-- Proyectos: usuarios activos leen y escriben
create policy "proyectos_select" on public.proyectos for select using (public.es_activo());
create policy "proyectos_insert" on public.proyectos for insert with check (public.es_activo());
create policy "proyectos_update" on public.proyectos for update using (public.es_activo());
create policy "proyectos_delete" on public.proyectos for delete using (public.es_admin());

-- Fases plantilla: todos leen; admin gestiona
create policy "fases_select" on public.fases_plantilla for select using (public.es_activo());
create policy "fases_insert" on public.fases_plantilla for insert with check (public.es_activo());
create policy "fases_update" on public.fases_plantilla for update using (public.es_activo());
create policy "fases_delete" on public.fases_plantilla for delete using (public.es_admin());

-- Proyecto_fases: todos activos
create policy "pf_all" on public.proyecto_fases for all using (public.es_activo());

-- Gastos: todos activos
create policy "gastos_select" on public.gastos for select using (public.es_activo());
create policy "gastos_insert" on public.gastos for insert with check (public.es_activo());
create policy "gastos_update" on public.gastos for update using (public.es_activo());
create policy "gastos_delete" on public.gastos for delete using (public.es_activo());

-- Notas rápidas: todos activos
create policy "notas_all" on public.notas_rapidas for all using (public.es_activo());

-- Contactos: todos activos
create policy "contactos_all" on public.contactos for all using (public.es_activo());

-- Notas texto: todos activos
create policy "notastexto_all" on public.notas_texto for all using (public.es_activo());

-- ════════════════════════════════════════════════════════════
--  TRIGGER: crear perfil automáticamente al registrar usuario
-- ════════════════════════════════════════════════════════════
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.perfiles (id, nombre, rol)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'rol', 'operario')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ════════════════════════════════════════════════════════════
--  TRIGGER: updated_at automático en proyectos
-- ════════════════════════════════════════════════════════════
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger proyectos_updated_at
  before update on public.proyectos
  for each row execute function public.set_updated_at();

-- ════════════════════════════════════════════════════════════
--  DATOS INICIALES — Fases por defecto
-- ════════════════════════════════════════════════════════════
insert into public.fases_plantilla (nombre, descripcion, sector, orden) values
  ('Estudio de mercado y viabilidad',  'Analizar precios comparables y calcular ARV.',          'legal',  1),
  ('Visita y peritación técnica',       'Visita con arquitecto técnico, informe de estado.',     'arq',    2),
  ('Due Diligence legal',               'Cargas, hipotecas, IBI, registro.',                    'legal',  3),
  ('Contrato de arras',                 'Firma y pago de señal para reservar el inmueble.',     'legal',  4),
  ('Firma notarial y escritura',        'Escritura de compraventa y liquidación de impuestos.', 'legal',  5),
  ('Proyecto básico y ejecutivo',       'Arquitecto redacta proyecto. Solicitud de licencia.',  'arq',    6),
  ('Selección de contratistas',         'Petición de presupuestos, comparativa y contrato.',    'obra',   7),
  ('Inicio de obra y demolición',       'Acta de inicio, vaciado y demolición si procede.',    'obra',   8),
  ('Estructura y albañilería',          'Tabiques, suelos, techos y estructura general.',       'obra',   9),
  ('Instalación eléctrica',             'Cuadro, cableado, puntos de luz y enchufes.',          'elect',  10),
  ('Instalación de fontanería',         'Tuberías, desagües, baño y cocina.',                   'font',   11),
  ('Climatización y HVAC',              'Instalación de aire acondicionado y calefacción.',     'font',   12),
  ('Alicatado y pavimento',             'Colocación de azulejos, baldosas y parqué.',           'obra',   13),
  ('Carpintería y puertas',             'Puertas, armarios y carpintería en general.',          'dis',    14),
  ('Pintura y acabados finales',        'Pintura, molduras y acabados decorativos.',             'dis',    15),
  ('Cocina y baños — equipamiento',     'Muebles de cocina, sanitarios y grifería.',            'dis',    16),
  ('Certificado final de obra',         'Obtención de cédula de habitabilidad.',                'arq',    17),
  ('Fotografía y home staging',         'Fotografía profesional y puesta en escena.',           'dis',    18)
on conflict do nothing;
