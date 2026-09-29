-- More reactions (docs/COMPETITIVE_ROADMAP.md F1.3): 24 emoji and 12 quick
-- phrases. The list lives here, and its client mirror in
-- lib/realtime/reactions.ts; tests/parity checks they match. It only ever
-- grows: older app versions still send the original six emoji.
--
-- Reactions are fixed text, never free text, so they need no filtering;
-- the one-per-second rate limit and blocking apply exactly as for chat.

create or replace function private.allowed_reactions()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    '👋',
    '👏',
    '😅',
    '🔥',
    '💛',
    '😂',
    '🎲',
    '🍀',
    '🎯',
    '🏆',
    '👑',
    '⭐',
    '😮',
    '😬',
    '😱',
    '🙈',
    '😎',
    '🤞',
    '🙌',
    '💪',
    '🤝',
    '🎉',
    '🤔',
    '😴',
    'Nice move!',
    'So close!',
    'Lucky roll!',
    'Well played',
    'Good luck',
    'Oops!',
    'Hurry up 😅',
    'Your turn',
    'Thanks!',
    'Good game',
    'One more game?',
    'Revenge!'
  ];
$$;
revoke execute on function private.allowed_reactions() from public;

-- Redefines 20260916221000_explicit_table_grants.sql's version: the
-- reaction check reads the list above.
CREATE OR REPLACE FUNCTION public.send_table_message(p_room_id uuid, p_text text, p_kind text DEFAULT 'chat'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if p_kind = 'reaction' and not (p_text = any(private.allowed_reactions())) then raise exception 'INVALID_MESSAGE'; end if;
  if exists(select 1 from public.table_messages where player_id = v_player and created_at > now() - interval '1 second') then
    raise exception 'Please wait a moment before sending another message.';
  end if;
  insert into public.table_messages(room_id,player_id,text,kind)
  values (p_room_id,v_player,btrim(p_text),p_kind) returning * into v_message;
  v_payload := jsonb_build_object('id',v_message.id,'playerId',v_player,'text',v_message.text,'kind',v_message.kind,'createdAt',v_message.created_at);
  perform realtime.send(v_payload,'table_message','room:' || p_room_id::text,true);
  return v_payload;
end;
$function$;
