-- WhatsApp-чаты бота-продажника. Выполни один раз в Supabase → SQL Editor.

create table if not exists public.wa_messages (
  id          bigint generated always as identity primary key,
  jid         text not null,                       -- WhatsApp чат (номер@s.whatsapp.net)
  phone       text,                                -- номер клиента (только цифры)
  name        text,                                -- имя из WhatsApp-профиля (если есть)
  sender      text not null default 'customer',    -- customer | bot | manager
  text        text,                                -- текст сообщения
  created_at  timestamptz not null default now()
);

-- Быстрый доступ по чату и времени
create index if not exists wa_messages_jid_idx on public.wa_messages (jid, created_at);
create index if not exists wa_messages_created_idx on public.wa_messages (created_at desc);

-- RLS: вставка только сервером (service_role обходит RLS), чтение — только авторизованный админ
alter table public.wa_messages enable row level security;

drop policy if exists "wa_messages admin read" on public.wa_messages;
create policy "wa_messages admin read"
  on public.wa_messages for select
  to authenticated
  using (true);

-- Публичный anon-ключ НЕ имеет доступа (ни чтения, ни записи) — политик для него нет.
