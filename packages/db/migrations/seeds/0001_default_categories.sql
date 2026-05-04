-- =====================================================================
-- meu-jarvis (Expressia) — Categorias Default PT-PT
-- Seed: 0001_default_categories.sql
-- Data: 2026-05-04
-- Autora: Dara (@data-engineer)
--
-- Trace: PRD FR18, Epic 4 AC8, market_pt_pt_exclusive.md, CON3.
--
-- Categorias globais (household_id IS NULL, is_default = true) — visíveis a TODOS
-- os households como template. Cada household pode adicionar custom por cima.
--
-- IMPORTANTE: Nomes em PT-PT exclusivo (sem PT-BR). Cores agnósticas (categoria
-- decide ícone, design system decide paleta).
--
-- Idempotência: ON CONFLICT (household_id, name) DO NOTHING — re-aplicar é safe.
-- =====================================================================

insert into public.categories
  (household_id, name, icon, color, is_default, kind, sort_order)
values
  -- ── DESPESAS ────────────────────────────────────────────────────
  (null, 'Mercearia',          'shopping-cart',   '#10B981', true, 'expense', 10),
  (null, 'Restauração',        'utensils',        '#F59E0B', true, 'expense', 20),
  (null, 'Combustível',        'fuel',            '#EF4444', true, 'expense', 30),
  (null, 'Transportes',        'bus',             '#3B82F6', true, 'expense', 35),
  (null, 'Saúde',              'heart-pulse',     '#EC4899', true, 'expense', 40),
  (null, 'Habitação',          'home',            '#8B5CF6', true, 'expense', 50),
  -- Sub-tipos comuns de Habitação podem ser modelados como sub-categorias
  -- (parent_id) por household após o seed inicial.
  (null, 'Água',               'droplet',         '#06B6D4', true, 'expense', 60),
  (null, 'Electricidade',      'zap',             '#FBBF24', true, 'expense', 70),
  (null, 'Gás',                'flame',           '#F97316', true, 'expense', 80),
  (null, 'Internet',           'wifi',            '#0EA5E9', true, 'expense', 90),
  (null, 'Telemóvel',          'smartphone',      '#6366F1', true, 'expense', 100),
  (null, 'Educação',           'graduation-cap',  '#7C3AED', true, 'expense', 110),
  (null, 'Lazer',              'gamepad-2',       '#A855F7', true, 'expense', 120),
  (null, 'Subscrições',        'credit-card',     '#14B8A6', true, 'expense', 130),
  (null, 'Vestuário',          'shirt',           '#F472B6', true, 'expense', 140),
  (null, 'Cuidados pessoais',  'sparkles',        '#FB7185', true, 'expense', 150),
  (null, 'Animais',            'paw-print',       '#84CC16', true, 'expense', 160),
  (null, 'Presentes',          'gift',            '#E11D48', true, 'expense', 170),
  (null, 'Impostos',           'landmark',        '#475569', true, 'expense', 180),
  (null, 'Outros gastos',      'circle-dashed',   '#6B7280', true, 'expense', 999),

  -- ── RENDIMENTOS ─────────────────────────────────────────────────
  (null, 'Salário',            'banknote',        '#22C55E', true, 'income',   10),
  (null, 'Outros rendimentos', 'plus-circle',     '#10B981', true, 'income',  990),
  (null, 'Investimentos',      'trending-up',     '#0EA5E9', true, 'income',   20),

  -- ── TRANSFERÊNCIAS ──────────────────────────────────────────────
  (null, 'Transferência',      'arrow-left-right','#94A3B8', true, 'transfer', 10)

on conflict (household_id, name) do nothing;

comment on table public.categories is
  'Categorias globais (household_id NULL, is_default=true) ou per-household. '
  'Seed PT-PT em seeds/0001_default_categories.sql. Re-aplicar é idempotente.';
