-- ============================================================
--  RFC · CloudPayments — добавление колонок для оплаты
--  Запусти ОДИН раз в Supabase → SQL Editor → New query → Run
-- ============================================================

alter table public.rfc_orders
  add column if not exists payment_status   text default 'pending',
  add column if not exists payment_provider text,
  add column if not exists payment_id       text,
  add column if not exists payment_meta     jsonb,
  add column if not exists updated_at       timestamptz default now();

-- Индекс для быстрого поиска по статусу оплаты в CRM
create index if not exists rfc_orders_payment_status_idx
  on public.rfc_orders (payment_status);

-- Если колонка updated_at добавлена впервые — заполним для старых строк
update public.rfc_orders set updated_at = created_at where updated_at is null;
