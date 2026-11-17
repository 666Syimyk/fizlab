-- ФизЛаб 3D — исходная схема БД: вузы, профили, инвайт-коды, аналитика, прогресс.
-- Вставьте этот файл целиком в Supabase Dashboard → SQL Editor → Run.
-- Безопасно перезапускать: миграция идемпотентна (drop-and-recreate для policy/trigger/function).

-- =========================================================================
-- 1. ТАБЛИЦЫ
-- =========================================================================

create table if not exists public.universities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text,
  license_until date,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role text not null default 'student' check (role in ('admin', 'teacher', 'student')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  university_id uuid references public.universities (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.invite_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  university_id uuid not null references public.universities (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'student' check (role = 'student'),
  max_uses integer not null default 1 check (max_uses > 0),
  used_count integer not null default 0 check (used_count >= 0),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type in ('topic_opened', 'problem_solved', 'sim_started')),
  topic_slug text,
  created_at timestamptz not null default now()
);

create table if not exists public.progress (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  solved_problem_ids jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_profiles_university on public.profiles (university_id);
create index if not exists idx_invite_codes_university on public.invite_codes (university_id);
create index if not exists idx_invite_codes_created_by on public.invite_codes (created_by);
create index if not exists idx_events_user on public.events (user_id);
create index if not exists idx_events_topic on public.events (topic_slug);
create index if not exists idx_events_created_at on public.events (created_at);

-- =========================================================================
-- 2. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (SECURITY DEFINER — чтобы избежать рекурсии RLS)
-- =========================================================================

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'teacher' and status = 'approved'
  );
$$;

create or replace function public.current_university_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select university_id from public.profiles where id = auth.uid();
$$;

-- Защита от повышения привилегий: обычный пользователь не может сам себе
-- назначить role/status/university_id ни при вставке, ни при обновлении своей строки.
-- Обходится только для: админа, серверных вызовов без JWT (auth.uid() is null —
-- ручной SQL Editor / service_role) и функции redeem_invite_code (через локальный флаг).
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin()
     or auth.uid() is null
     or coalesce(current_setting('app.bypass_profile_guard', true), '') = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.id is distinct from auth.uid() then
      raise exception 'Нельзя создать профиль от имени другого пользователя';
    end if;
    if new.role not in ('teacher', 'student') then
      raise exception 'Недопустимая роль при регистрации';
    end if;
    if new.status is distinct from 'pending' then
      raise exception 'Новый профиль должен иметь статус pending';
    end if;
    return new;
  end if;

  if new.role is distinct from old.role
     or new.status is distinct from old.status
     or new.university_id is distinct from old.university_id then
    raise exception 'Недостаточно прав для изменения этого поля профиля';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_fields on public.profiles;
create trigger trg_protect_profile_fields
  before insert or update on public.profiles
  for each row execute function public.protect_profile_fields();

-- Атомарная активация студента по инвайт-коду: проверяет код, увеличивает
-- счётчик использований и создаёт/обновляет профиль как approved-student.
create or replace function public.redeem_invite_code(p_code text, p_full_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.invite_codes%rowtype;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Требуется авторизация';
  end if;

  select * into v_invite from public.invite_codes where code = p_code for update;

  if not found then
    raise exception 'Код приглашения не найден';
  end if;
  if v_invite.expires_at is not null and v_invite.expires_at < now() then
    raise exception 'Срок действия кода истёк';
  end if;
  if v_invite.used_count >= v_invite.max_uses then
    raise exception 'Код приглашения уже использован максимальное число раз';
  end if;

  update public.invite_codes set used_count = used_count + 1 where id = v_invite.id;

  perform set_config('app.bypass_profile_guard', 'on', true);

  insert into public.profiles (id, full_name, role, status, university_id)
  values (v_uid, p_full_name, 'student', 'approved', v_invite.university_id)
  on conflict (id) do update
    set full_name = excluded.full_name,
        role = 'student',
        status = 'approved',
        university_id = excluded.university_id;

  return v_invite.university_id;
end;
$$;

grant execute on function public.redeem_invite_code(text, text) to authenticated;

-- =========================================================================
-- 3. ROW LEVEL SECURITY
-- =========================================================================

alter table public.universities enable row level security;
alter table public.profiles enable row level security;
alter table public.invite_codes enable row level security;
alter table public.events enable row level security;
alter table public.progress enable row level security;

-- --- universities: публично читаемы (нужно для формы регистрации и проверки
-- лицензии на клиенте); создавать может любой авторизованный (вариант "другое"
-- в форме регистрации преподавателя); менять/удалять — только админ.
drop policy if exists "universities_select_all" on public.universities;
create policy "universities_select_all" on public.universities
  for select using (true);

drop policy if exists "universities_insert_authenticated" on public.universities;
create policy "universities_insert_authenticated" on public.universities
  for insert with check (auth.uid() is not null);

drop policy if exists "universities_update_admin" on public.universities;
create policy "universities_update_admin" on public.universities
  for update using (public.is_admin());

drop policy if exists "universities_delete_admin" on public.universities;
create policy "universities_delete_admin" on public.universities
  for delete using (public.is_admin());

-- --- profiles: свою строку видит каждый; админ видит всех; преподаватель —
-- студентов своего вуза. Вставка/обновление своей строки разрешены, но
-- role/status/university_id защищены триггером protect_profile_fields.
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select using (
    id = auth.uid()
    or public.is_admin()
    or (public.is_teacher() and university_id = public.current_university_id())
  );

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (id = auth.uid());

drop policy if exists "profiles_update_own_or_admin" on public.profiles;
create policy "profiles_update_own_or_admin" on public.profiles
  for update using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- --- invite_codes: админ видит все; преподаватель — только свои. Создавать
-- может только преподаватель и только для своего вуза. Студенты не читают эту
-- таблицу напрямую — активация кода идёт через redeem_invite_code().
drop policy if exists "invite_codes_select" on public.invite_codes;
create policy "invite_codes_select" on public.invite_codes
  for select using (
    public.is_admin() or created_by = auth.uid()
  );

drop policy if exists "invite_codes_insert_teacher" on public.invite_codes;
create policy "invite_codes_insert_teacher" on public.invite_codes
  for insert with check (
    (public.is_admin() or public.is_teacher())
    and created_by = auth.uid()
    and (public.is_admin() or university_id = public.current_university_id())
  );

drop policy if exists "invite_codes_update_admin" on public.invite_codes;
create policy "invite_codes_update_admin" on public.invite_codes
  for update using (public.is_admin());

-- --- events: пишет только сам пользователь про себя; читает сам, админ (всё)
-- и преподаватель (события студентов своего вуза) — для аналитики.
drop policy if exists "events_insert_own" on public.events;
create policy "events_insert_own" on public.events
  for insert with check (user_id = auth.uid());

drop policy if exists "events_select" on public.events;
create policy "events_select" on public.events
  for select using (
    user_id = auth.uid()
    or public.is_admin()
    or (public.is_teacher() and exists (
      select 1 from public.profiles p
      where p.id = events.user_id and p.university_id = public.current_university_id()
    ))
  );

-- --- progress: та же схема видимости, что и у events; пишет только сам
-- пользователь про себя (upsert через клиент).
drop policy if exists "progress_select" on public.progress;
create policy "progress_select" on public.progress
  for select using (
    user_id = auth.uid()
    or public.is_admin()
    or (public.is_teacher() and exists (
      select 1 from public.profiles p
      where p.id = progress.user_id and p.university_id = public.current_university_id()
    ))
  );

drop policy if exists "progress_insert_own" on public.progress;
create policy "progress_insert_own" on public.progress
  for insert with check (user_id = auth.uid());

drop policy if exists "progress_update_own" on public.progress;
create policy "progress_update_own" on public.progress
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());
