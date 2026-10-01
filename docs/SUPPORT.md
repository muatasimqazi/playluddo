# Support procedures

For whoever answers support@luddohouse.com. Reports about players are handled as described in [`IOS_RELEASE.md`](IOS_RELEASE.md) → "Player safety". This page covers age answers.

## Correcting an age answer

Players give their birth month and year once, before their first online table, and can't change it in the app ([`COMPETITIVE_ROADMAP.md`](COMPETITIVE_ROADMAP.md) F0.4). Typical requests:

- "I typed the wrong year and now I can't play online."
- "My child answered on my phone, and now my account says I'm under 13."
- "I'm 18 but video says it isn't available." Check this one first: video also needs a signed-in account (not a guest), a private table, and every other person seated to be signed in and 18+. An age correction only helps if the answer itself is wrong.

### 1. Check who's asking

Reply only to the email address on the account, or ask them to write from it. Never correct an age based on a message from a different address. Guests have no email, so ask for the room code of a table they played at and the name they used there; you'll find the account from that in step 2.

Ask for the **birth month and year** only. Don't ask for ID documents, and don't keep any that are sent.

### 2. Find the account

Supabase dashboard → SQL editor:

```sql
select id, email, phone, is_anonymous, created_at
from auth.users
where email = 'player@example.com';
```

A guest, from a room they played in:

```sql
select p.user_id, p.display_name, r.created_at
from public.players p join public.rooms r on r.id = p.room_id
where r.code = 'ABCD12' and p.display_name = 'Sam';
```

To see what they answered, and any earlier corrections:

```sql
select birth_year, birth_month, eligible_from, source, declared_at
from private.age_declarations where user_id = '<id>';

select action, previous, corrected, reason, ticket, corrected_by, corrected_at
from private.age_corrections where user_id = '<id>' order by corrected_at desc;
```

`eligible_from` set with no birth year means they answered under 13.

### 3. Make the correction

Always use the function. Never edit `private.age_declarations` by hand: the function validates the date, keeps an under-13 answer free of birth data, and writes the audit row.

Set the right month and year:

```sql
select private.support_correct_age(
  '<id>',
  'Your name',
  'Mistyped 2013 for 1993, confirmed from the account email',
  1993, 4,           -- birth year, birth month
  'SUP-123'          -- ticket or email thread reference (optional)
);
```

Or clear the answer, so they're asked again at their next online table:

```sql
select private.support_correct_age('<id>', 'Your name', 'Asked to answer again', null, null, 'SUP-124');
```

The result shows what the player can now do (`online`, `video`), never the birth data. They may need to reload the app.

The answer is **final** after a correction, as before. A player who keeps asking to change their age, especially toward an older one, is a reason to decline rather than correct again. The audit table shows the history.

### 4. Under-13 answers

If a parent tells you a child under 13 is using an account:

- **Guest (no email or phone):** set the child's real month and year with the function, so the account is held back from online play. Guest accounts with an under-13 answer are deleted automatically after 30 days without activity.
- **Signed-in account:** don't delete or change anything yet. How we handle signed-in under-13 accounts is waiting on the launch-market legal review (F0.4, decision 13). Reply that you've received the request, and escalate it.

### What's kept

The audit row records who made the change, why, and the answer before and after; an under-13 answer has no birth data. It's deleted with the account, along with the answer itself.
