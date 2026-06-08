-- ============================================================
--  RFC · Launch · подписки + wait-list
--  Запусти ОДИН раз в Supabase → SQL Editor → New query → Run
-- ============================================================

-- 1. Подписчики на рассылку (footer newsletter)
create table if not exists public.rfc_subscribers (
  email       text primary key,
  source      text default 'footer',  -- footer / waitlist / etc
  created_at  timestamptz default now()
);

-- 2. Wait-list для Coming Soon товаров
create table if not exists public.rfc_waitlist (
  id            bigserial primary key,
  email         text not null,
  product_id    text not null,
  product_name  text,
  notified_at   timestamptz,
  created_at    timestamptz default now(),
  unique (email, product_id)
);

-- Индексы для админ-запросов
create index if not exists rfc_subscribers_created_idx on public.rfc_subscribers (created_at desc);
create index if not exists rfc_waitlist_product_idx    on public.rfc_waitlist (product_id);
create index if not exists rfc_waitlist_created_idx    on public.rfc_waitlist (created_at desc);
