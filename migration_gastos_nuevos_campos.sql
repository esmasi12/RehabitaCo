-- ════════════════════════════════════════════════════════════
--  RehabitaCo — Migración: nuevos campos en tabla gastos
--  Ejecuta este SQL en: supabase.com → SQL Editor → New query
-- ════════════════════════════════════════════════════════════

-- Campo: gasolina (€ de desplazamiento asociado al gasto)
ALTER TABLE public.gastos
  ADD COLUMN IF NOT EXISTS gasolina numeric(8,2) DEFAULT NULL;

-- Campo: horas (tiempo propio invertido, no remunerado)
ALTER TABLE public.gastos
  ADD COLUMN IF NOT EXISTS horas numeric(6,2) DEFAULT NULL;

-- ════════════════════════════════════════════════════════════
--  VERIFICACIÓN — comprueba que los campos existen
-- ════════════════════════════════════════════════════════════
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'gastos'
  AND column_name IN ('gasolina','horas');
