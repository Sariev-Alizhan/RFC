-- === RFC WhatsApp: ответы из CRM + фото клиентов ===
-- Выполни ОДИН РАЗ в Supabase → SQL Editor. Безопасно повторно (idempotent).

-- 1) Медиа в сообщениях (фото/видео/файлы клиентов)
alter table public.wa_messages add column if not exists media_url  text; -- ссылка на файл в Storage
alter table public.wa_messages add column if not exists media_type text; -- image | video | audio | document

-- 2) Очередь исходящих ответов из CRM (менеджер пишет → бот отправляет в WhatsApp)
create table if not exists public.wa_outbox (
  id          bigint generated always as identity primary key,
  jid         text not null,                        -- куда слать (номер@s.whatsapp.net)
  text        text not null,                        -- текст ответа
  status      text not null default 'pending',      -- pending | sending | sent | failed
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create index if not exists wa_outbox_status_idx on public.wa_outbox (status, created_at);

alter table public.wa_outbox enable row level security;

-- Админ (залогиненный в CRM) может ставить ответ в очередь и видеть статус
drop policy if exists "wa_outbox admin insert" on public.wa_outbox;
create policy "wa_outbox admin insert" on public.wa_outbox
  for insert to authenticated with check (true);

drop policy if exists "wa_outbox admin read" on public.wa_outbox;
create policy "wa_outbox admin read" on public.wa_outbox
  for select to authenticated using (true);
-- (обновляет статус только бот через сервер = service_role, обходит RLS)

-- 3) Bucket для медиа (публичное чтение по непубличной ссылке-пути)
insert into storage.buckets (id, name, public)
values ('wa-media', 'wa-media', true)
on conflict (id) do nothing;

-- Разрешаем публичное чтение объектов бакета wa-media (для <img src> в CRM)
drop policy if exists "wa-media public read" on storage.objects;
create policy "wa-media public read" on storage.objects
  for select using (bucket_id = 'wa-media');
