-- Expiración real de waitlist: cuando un partido inicia, las filas 'waiting' pasan a 'expired'
-- con left_at = hora REAL de inicio del partido (no el momento del barrido).
-- Solo persistencia/analítica: la UX ya oculta la waitlist al iniciar.

-- 1) Ampliar el CHECK de status para permitir 'expired'.
alter table public.game_waitlist
  drop constraint if exists game_waitlist_status_check;

alter table public.game_waitlist
  add constraint game_waitlist_status_check
  check (status in ('waiting', 'reserved', 'canceled', 'expired'));

-- 2) RPC SECURITY DEFINER: expira las filas 'waiting' de partidos ya iniciados.
--    Réplica de gameStartDate: (date_key + time) interpretado en hora Lima.
--    Idempotente: solo toca status='waiting'; nunca reserved/canceled/expired.
create or replace function public.expire_waitlists()
returns void
language sql
security definer
set search_path = public
as $$
  update game_waitlist w
     set status  = 'expired',
         left_at = ((g.date_key::date + g.time) at time zone 'America/Lima')  -- hora real de inicio
    from games g
   where w.game_id = g.id
     and w.status  = 'waiting'
     and ((g.date_key::date + g.time) at time zone 'America/Lima') <= now();   -- ya inició
$$;

grant execute on function public.expire_waitlists() to authenticated;
