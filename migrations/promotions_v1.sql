-- ============================================================================
-- Promociones · V1 — descuento fijo/porcentual + vigencia + límites de uso
-- ============================================================================
-- Amplía promo_codes (percent | fixed, starts_at, max_uses_total,
-- max_uses_per_user) y enlaza el USO REAL de una promo desde reservations vía
-- reservations.promo_code_id (FK). SIN contadores ni triggers: reservations
-- (append-only) es la FUENTE DE VERDAD de usos. Los refunds NO restan usos.
--
-- Compatibilidad: los promo_codes actuales quedan como discount_type='percent'
-- (DEFAULT), con discount_percent intacto → toda query que lea discount_percent
-- sigue funcionando. discount_percent pasa a NULLABLE (en 'fixed' es NULL).
--
-- FUERA DE ALCANCE (fases posteriores): ciudad/venue/horario, monto mínimo, tope
-- de descuento, RPC de validación, y cambios en App/Admin.
-- ============================================================================

begin;

-- ── promo_codes ─────────────────────────────────────────────────────────────
-- Nuevas columnas. discount_type NOT NULL DEFAULT 'percent' → rellena los
-- registros existentes como porcentuales automáticamente.
alter table public.promo_codes
  add column if not exists discount_type     text        not null default 'percent',
  add column if not exists discount_amount   numeric(10,2),
  add column if not exists starts_at         timestamptz,
  add column if not exists max_uses_total    integer,
  add column if not exists max_uses_per_user integer;

-- En 'fixed' el porcentaje es NULL: discount_percent deja de ser obligatorio.
-- (No-op si el entorno ya lo tenía nullable.)
alter table public.promo_codes
  alter column discount_percent drop not null;

-- discount_type ∈ {percent, fixed}.
alter table public.promo_codes drop constraint if exists promo_codes_discount_type_check;
alter table public.promo_codes
  add constraint promo_codes_discount_type_check
  check (discount_type in ('percent', 'fixed'));

-- Coherencia por tipo (fuente única del descuento; sin campo genérico discount_value):
--   percent → discount_percent presente en (0,100], discount_amount NULL.
--   fixed   → discount_amount presente (>0), discount_percent NULL.
alter table public.promo_codes drop constraint if exists promo_codes_discount_coherence_check;
alter table public.promo_codes
  add constraint promo_codes_discount_coherence_check
  check (
    (discount_type = 'percent' and discount_percent is not null and discount_percent > 0 and discount_percent <= 100 and discount_amount is null)
    or
    (discount_type = 'fixed'   and discount_amount  is not null and discount_amount > 0 and discount_percent is null)
  );

-- Límites de uso: NULL = ilimitado; si se define, debe ser > 0.
alter table public.promo_codes drop constraint if exists promo_codes_max_uses_total_check;
alter table public.promo_codes
  add constraint promo_codes_max_uses_total_check
  check (max_uses_total is null or max_uses_total > 0);

alter table public.promo_codes drop constraint if exists promo_codes_max_uses_per_user_check;
alter table public.promo_codes
  add constraint promo_codes_max_uses_per_user_check
  check (max_uses_per_user is null or max_uses_per_user > 0);

-- Vigencia coherente: si ambas fechas existen, el inicio debe ser ESTRICTAMENTE anterior
-- a la expiración (NULL en cualquiera → válido). Impide starts_at >= expires_at.
alter table public.promo_codes drop constraint if exists promo_codes_validity_window_check;
alter table public.promo_codes
  add constraint promo_codes_validity_window_check
  check (starts_at is null or expires_at is null or starts_at < expires_at);

-- ── reservations ────────────────────────────────────────────────────────────
-- Enlace del uso real de promo. Mismo tipo que promo_codes.id (uuid). NULL = reserva
-- sin promo. Append-only: no se borra; los refunds NO restan usos (siguen consumidos).
alter table public.reservations
  add column if not exists promo_code_id uuid;

-- FK. ON DELETE por defecto (NO ACTION): no se puede borrar un promo_code aún
-- referenciado por el ledger → preserva la trazabilidad del uso.
alter table public.reservations drop constraint if exists reservations_promo_code_id_fkey;
alter table public.reservations
  add constraint reservations_promo_code_id_fkey
  foreign key (promo_code_id) references public.promo_codes(id);

-- Índice para CONTAR usos (parcial sobre lo único que cuenta: status='spend' con promo).
--   Uso global    → COUNT where status='spend' and promo_code_id = X   (prefijo promo_code_id)
--   Uso por user  → ... and user_id = U                                (columna user_id)
-- El compuesto (promo_code_id, user_id) sirve AMBOS conteos por prefijo de columna, así
-- que NO se crea un índice extra de solo promo_code_id (sería redundante).
create index if not exists reservations_promo_usage_idx
  on public.reservations (promo_code_id, user_id)
  where status = 'spend' and promo_code_id is not null;

commit;
