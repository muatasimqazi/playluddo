-- Chat remains server authored. Clients cannot forge state_updated broadcasts.
create table public.table_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 240),
  kind text not null check (kind in ('chat', 'reaction')),
  created_at timestamptz not null default now()
);
create index table_messages_room_created on public.table_messages(room_id, created_at desc);
alter table public.table_messages enable row level security;
create policy "seated players can read table messages" on public.table_messages
for select to authenticated using ((select private.ludo_is_seated_in_room(room_id)));
grant select on public.table_messages to authenticated;

create or replace function public.send_table_message(p_room_id uuid, p_text text, p_kind text default 'chat')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_player uuid;
  v_message public.table_messages;
  v_payload jsonb;
begin
  if (select auth.uid()) is null then raise exception 'UNAUTHENTICATED'; end if;
  v_player := private.ludo_caller_player_id(p_room_id);
  if v_player is null then raise exception 'SEAT_NOT_CONTROLLED'; end if;
  -- Serialize per player so concurrent requests cannot bypass the rate limit.
  perform id from public.players where id = v_player for update;
  if p_kind is null or p_kind not in ('chat','reaction') or p_text is null or char_length(btrim(p_text)) not between 1 and 240 then
    raise exception 'INVALID_MESSAGE';
  end if;
  if p_kind = 'reaction' and p_text not in ('👋','👏','🎲','😅','🔥','💛') then raise exception 'INVALID_MESSAGE'; end if;
  if exists(select 1 from public.table_messages where player_id = v_player and created_at > now() - interval '1 second') then
    raise exception 'Please wait a moment before sending another message.';
  end if;
  insert into public.table_messages(room_id,player_id,text,kind)
  values (p_room_id,v_player,btrim(p_text),p_kind) returning * into v_message;
  v_payload := jsonb_build_object('id',v_message.id,'playerId',v_player,'text',v_message.text,'kind',v_message.kind,'createdAt',v_message.created_at);
  perform realtime.send(v_payload,'table_message','room:' || p_room_id::text,true);
  return v_payload;
end;
$$;
revoke execute on function public.send_table_message(uuid,text,text) from public;
grant execute on function public.send_table_message(uuid,text,text) to authenticated;
