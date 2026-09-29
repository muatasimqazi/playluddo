-- Party Mode phone controllers (docs/COMPETITIVE_ROADMAP.md Section 6, P3)
-- have a reaction pad that shows on the shared screen. Reactions come from a
-- fixed list (private.allowed_reactions()), so they carry no free text:
-- party rooms still have no chat.

-- Redefines 20260928090000_party_screen.sql's version: reactions are let through.
create or replace function private.party_no_chat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind <> 'reaction' and (select is_party from public.rooms where id = new.room_id) then
    raise exception 'PARTY_ROOM';
  end if;
  return new;
end;
$$;
revoke execute on function private.party_no_chat() from public;
