-- Include public profile choices in room snapshots without duplicating Auth
-- metadata into the gameplay tables. Bots receive deterministic avatars.
create or replace function private.ludo_room_state_json(p_room_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'roomId', r.id,
    'hostPlayerId', r.host_player_id,
    'code', r.code,
    'gameType', r.game_type,
    'status', r.status,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'seatIndex', p.seat_index, 'displayName', p.display_name,
        'color', p.color, 'status', p.status, 'isBot', p.is_bot,
        'missedDecisionCount', p.missed_decision_count, 'level', p.level,
        'testWalletBalance', p.test_wallet_balance,
        'autoRollEnabled', p.auto_roll_enabled,
        'rematchReady', p.rematch_ready, 'inVoice', p.in_voice,
        'avatarId', coalesce(
          (select u.raw_user_meta_data ->> 'avatar_id' from auth.users u where u.id = p.user_id),
          (array['fox', 'panda', 'owl', 'frog'])[p.seat_index + 1]
        ),
        'country', coalesce(
          (select u.raw_user_meta_data ->> 'country' from auth.users u where u.id = p.user_id),
          ''
        )
      ) order by p.seat_index)
      from public.players p where p.room_id = r.id
    ), '[]'::jsonb),
    'pawns', private.ludo_room_pawns_json(r.id),
    'turnPlayerId', r.turn_player_id, 'turnPhase', r.turn_phase,
    'turnDeadlineAt', r.turn_deadline_at, 'rollsThisTurn', r.rolls_this_turn,
    'activeDiceValue', r.active_dice_value,
    'consecutiveSixes', r.consecutive_sixes,
    'legalMoves', case
      when r.game_type = 'ludo' and r.turn_phase = 'awaiting_move'
        and r.turn_player_id is not null and r.active_dice_value is not null
      then private.ludo_legal_moves(
        private.ludo_room_pawns_json(r.id),
        (select color from public.players where id = r.turn_player_id),
        r.active_dice_value
      ) else '[]'::jsonb end,
    'winnerIds', coalesce(to_jsonb(r.winner_ids), '[]'::jsonb),
    'matchEndReason', r.match_end_reason, 'eventSequence', r.event_sequence
  ) from public.rooms r where r.id = p_room_id;
$$;
