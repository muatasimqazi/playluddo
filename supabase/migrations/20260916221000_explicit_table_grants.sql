-- Supabase's default privileges may grant new tables/functions to API roles
-- before our explicit GRANTs run. Remove those inherited grants first.
-- Game clients read snapshots and send intents through the existing RPCs.
revoke all on public.rooms, public.players, public.pawns, public.match_events from anon;
revoke insert, update, delete, truncate, references, trigger on public.rooms, public.players, public.pawns, public.match_events from authenticated;
revoke all on public.table_messages from anon, authenticated;
grant select on public.table_messages to authenticated;
revoke execute on function public.send_table_message(uuid,text,text) from anon;
