-- Run this whole file in Supabase → SQL Editor.
-- Also enable: Authentication → Providers → Anonymous Sign-ins.

create table rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  status text not null default 'waiting' check (status in ('waiting','playing','finished')),
  fen text not null default 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  ply int not null default 0,
  created_at timestamptz default now()
);

-- seat 0 = Team A P1, 1 = Team B P1, 2 = Team A P2, 3 = Team B P2
create table room_players (
  room_id uuid references rooms on delete cascade,
  user_id uuid not null,
  seat int not null check (seat between 0 and 3),
  name text,
  primary key (room_id, seat),
  unique (room_id, user_id)
);

create table moves (
  id bigserial primary key,
  room_id uuid references rooms on delete cascade,
  ply int not null,
  san text,
  fen_after text,
  user_id uuid,
  created_at timestamptz default now(),
  unique (room_id, ply)
);

alter publication supabase_realtime add table rooms, room_players, moves;

alter table rooms enable row level security;
alter table room_players enable row level security;
alter table moves enable row level security;
create policy "read rooms"   on rooms        for select to authenticated using (true);
create policy "read players" on room_players for select to authenticated using (true);
create policy "read moves"   on moves        for select to authenticated using (true);
-- No insert/update policies: every write goes through the functions below.

create or replace function create_room(p_code text)
returns uuid language sql security definer set search_path = public as $$
  insert into rooms(code) values (p_code) returning id;
$$;

create or replace function join_room(p_code text, p_name text)
returns int language plpgsql security definer set search_path = public as $$
declare r rooms; s int; n int;
begin
  select * into r from rooms where code = p_code;
  if r.id is null then raise exception 'room not found'; end if;
  select seat into s from room_players where room_id = r.id and user_id = auth.uid();
  if s is not null then return s; end if;  -- rejoin keeps your seat
  select min(g) into s from generate_series(0,3) g
    where g not in (select seat from room_players where room_id = r.id);
  if s is null then raise exception 'room full'; end if;
  insert into room_players values (r.id, auth.uid(), s, p_name);
  select count(*) into n from room_players where room_id = r.id;
  if n = 4 then update rooms set status = 'playing' where id = r.id; end if;
  return s;
end $$;

create or replace function make_move(
  p_room uuid, p_expected_ply int, p_fen text, p_san text, p_over boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare r rooms; s int;
begin
  select * into r from rooms where id = p_room for update;
  if r.status <> 'playing' then raise exception 'game not active'; end if;
  if r.ply <> p_expected_ply then raise exception 'stale move'; end if;
  select seat into s from room_players where room_id = p_room and user_id = auth.uid();
  if s is null or s <> r.ply % 4 then raise exception 'not your turn'; end if;
  update rooms set fen = p_fen, ply = ply + 1,
         status = case when p_over then 'finished' else 'playing' end
   where id = p_room;
  insert into moves(room_id, ply, san, fen_after, user_id)
  values (p_room, r.ply, p_san, p_fen, auth.uid());
end $$;
