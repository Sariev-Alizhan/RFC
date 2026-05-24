-- ============================================================
--  RFC · Red Flag Community — схема базы для облачной CRM
--  Запусти это ОДИН раз в Supabase → SQL Editor → New query → Run
-- ============================================================

create table if not exists public.orders (
  id          text primary key,
  created_at  timestamptz not null default now(),
  name        text,
  phone       text,
  email       text,
  country     text,
  city        text,
  address     text,
  comment     text,
  delivery    text,
  items       jsonb,
  total       integer,
  status      text not null default 'Новый'
);

-- Включаем защиту на уровне строк
alter table public.orders enable row level security;

-- 1) Любой посетитель сайта (anon) может СОЗДАТЬ заказ:
drop policy if exists "anon can insert orders" on public.orders;
create policy "anon can insert orders"
  on public.orders for insert to anon
  with check (true);

-- 2) ЧИТАТЬ / МЕНЯТЬ / УДАЛЯТЬ заказы может только вошедший админ (authenticated):
drop policy if exists "auth can read orders" on public.orders;
create policy "auth can read orders"
  on public.orders for select to authenticated using (true);

drop policy if exists "auth can update orders" on public.orders;
create policy "auth can update orders"
  on public.orders for update to authenticated using (true);

drop policy if exists "auth can delete orders" on public.orders;
create policy "auth can delete orders"
  on public.orders for delete to authenticated using (true);

-- ============================================================
--  ПОСЛЕ запуска SQL:
--  Authentication → Users → Add user → создай админский email + пароль.
--  Этим логином ты будешь входить в CRM на сайте (кнопка «Админ · CRM»).
--  Клиенты НЕ видят чужие заказы — только админ после входа.
-- ============================================================
