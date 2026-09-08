-- ============================================================================
-- Rewards · FASE 3 — Batería de regresión (funciones REALES, sin mocks)
-- ============================================================================
-- EJECUTAR COMPLETO como rol 'postgres' en el SQL editor de Supabase.
-- Cada suite es BEGIN … DO(assertions) … ROLLBACK → NO persiste NADA.
-- Cualquier assertion fallida lanza EXCEPTION (aborta la suite; el ROLLBACK limpia).
--
-- Requiere config REAL: player ON/5, captain ON/8, captain_gold ON/10 (Suite 1 aborta
-- si no coincide; NO modifica app_settings). La Suite 2 SÍ modifica app_settings pero
-- termina en ROLLBACK (temporal).
--
-- process_referral_rewards() es un barrido GLOBAL: durante el test también recorrería
-- newcomers reales de producción, pero TODO se revierte con ROLLBACK. Las assertions se
-- limitan SIEMPRE a los UUID de los fixtures (jamás a conteos globales ni al integer
-- devuelto por la función).
--
-- Nota Test 4: un rental 'reserved' de inicio anterior DIFIERE (guardia de orden). Se
-- prueba 4a (diferido) y 4b (tras cancelar el rental → recompensa). Ver auditoría.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- SUITE 1 · Elegibilidad, roles/montos (config real), idempotencia, invariantes
-- ════════════════════════════════════════════════════════════════════════════
begin;
do $$
declare
  f            uuid;                                  -- field
  ganchor      uuid;                                  -- game ancla (reserva compartida)
  r0           uuid;                                  -- reserva compartida (FK de game_players)
  -- referrers
  r1 uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid; r6 uuid;
  r8a uuid; r8b uuid; r9 uuid; r10 uuid; r11 uuid; r12 uuid; r13 uuid;
  -- newcomers
  n1 uuid; n2 uuid; n3 uuid; n4 uuid; n5 uuid; n6 uuid; n7 uuid; n8 uuid;
  n9 uuid; n10 uuid; n11 uuid; n12 uuid; n13 uuid;
  -- games auxiliares (reutilizados por escenario)
  ga uuid; gb uuid; grent uuid;
  -- helpers
  v_winner uuid; v_loser uuid; v_bal numeric; v_cnt int; v_eval timestamptz;
  -- config
  c_pe bool; c_pa numeric; c_ce bool; c_ca numeric; c_ge bool; c_ga numeric;
begin
  -- ── Guards ────────────────────────────────────────────────────────────────
  if session_user <> 'postgres' then
    raise exception 'Ejecuta como postgres (session_user=%)', session_user;
  end if;

  select reward_referral_player_enabled, reward_referral_player_amount,
         reward_referral_captain_enabled, reward_referral_captain_amount,
         reward_referral_captain_gold_enabled, reward_referral_captain_gold_amount
    into c_pe, c_pa, c_ce, c_ca, c_ge, c_ga
    from public.app_settings where id = 1;
  if not (c_pe and c_pa = 5 and c_ce and c_ca = 8 and c_ge and c_ga = 10) then
    raise exception 'CONFIG MISMATCH: esperado player ON/5, captain ON/8, gold ON/10; hallado %/% , %/% , %/%',
      c_pe, c_pa, c_ce, c_ca, c_ge, c_ga;
  end if;

  -- ── Fixtures base ─────────────────────────────────────────────────────────
  insert into public.fields (name, format, total_spots, duration_min)
    values ('ZZTEST_FIELD', '7v7', 14, 60) returning id into f;
  insert into public.games (field_id,type,status,date_key,time,duration_min,format,total_spots,price_per_person)
    values (f,'match','published','2019-01-01','10:00',60,'7v7',14,5) returning id into ganchor;
  insert into public.reservations (game_id) values (ganchor) returning id into r0;

  insert into public.users (full_name) values
    ('ZZ r1'),('ZZ r2'),('ZZ r3'),('ZZ r4'),('ZZ r5'),('ZZ r6'),
    ('ZZ r8a'),('ZZ r8b'),('ZZ r9'),('ZZ r10'),('ZZ r11'),('ZZ r12'),('ZZ r13');
  select id into r1  from public.users where full_name='ZZ r1';
  select id into r2  from public.users where full_name='ZZ r2';
  select id into r3  from public.users where full_name='ZZ r3';
  select id into r4  from public.users where full_name='ZZ r4';
  select id into r5  from public.users where full_name='ZZ r5';
  select id into r6  from public.users where full_name='ZZ r6';
  select id into r8a from public.users where full_name='ZZ r8a';
  select id into r8b from public.users where full_name='ZZ r8b';
  select id into r9  from public.users where full_name='ZZ r9';
  select id into r10 from public.users where full_name='ZZ r10';
  select id into r11 from public.users where full_name='ZZ r11';
  select id into r12 from public.users where full_name='ZZ r12';
  select id into r13 from public.users where full_name='ZZ r13';

  insert into public.users (full_name) values
    ('ZZ n1'),('ZZ n2'),('ZZ n3'),('ZZ n4'),('ZZ n5'),('ZZ n6'),('ZZ n7'),('ZZ n8'),
    ('ZZ n9'),('ZZ n10'),('ZZ n11'),('ZZ n12'),('ZZ n13');
  select id into n1  from public.users where full_name='ZZ n1';
  select id into n2  from public.users where full_name='ZZ n2';
  select id into n3  from public.users where full_name='ZZ n3';
  select id into n4  from public.users where full_name='ZZ n4';
  select id into n5  from public.users where full_name='ZZ n5';
  select id into n6  from public.users where full_name='ZZ n6';
  select id into n7  from public.users where full_name='ZZ n7';
  select id into n8  from public.users where full_name='ZZ n8';
  select id into n9  from public.users where full_name='ZZ n9';
  select id into n10 from public.users where full_name='ZZ n10';
  select id into n11 from public.users where full_name='ZZ n11';
  select id into n12 from public.users where full_name='ZZ n12';
  select id into n13 from public.users where full_name='ZZ n13';

  -- roles del referidor
  insert into public.user_roles (user_id, role) values
    (r10,'captain'), (r11,'captain_gold'), (r12,'captain'), (r12,'captain_gold'),
    (r13,'captain');                                  -- r13 cambia a gold antes de procesar (Test 13)
  update public.user_roles set role='captain_gold' where user_id=r13 and role='captain';

  -- wallet de referrers: invariante total = reserved + credit (100=60+40), reward 0
  insert into public.wallet_summary (user_id, total_amount, reserved_balance, credit_balance, reward_balance)
  select uid, 100, 60, 40, 0 from unnest(array[r1,r2,r3,r4,r5,r6,r8a,r8b,r9,r10,r11,r12,r13,n7]) uid;

  -- ── Escenarios ────────────────────────────────────────────────────────────
  -- T1: primer match referido completed → r1 +5
  insert into public.games (field_id,type,status,date_key,time,duration_min,format,total_spots,price_per_person)
    values (f,'match','completed','2020-01-01','10:00',60,'7v7',14,5) returning id into ga;
  insert into public.game_players (game_id,user_id,reservation_id,status,amount,referred_by_user_id)
    values (ga,n1,r0,'confirmed',5,r1);

  -- T2: match completed PREVIO sin referido + match referido posterior → r2 +0
  insert into public.games (field_id,type,status,date_key,time,duration_min,format,total_spots,price_per_person)
    values (f,'match','completed','2020-01-01','10:00',60,'7v7',14,5) returning id into ga;
  insert into public.game_players (game_id,user_id,reservation_id,status,amount,referred_by_user_id)
    values (ga,n2,r0,'confirmed',5,null);
  insert into public.games (field_id,type,status,date_key,time,duration_min,format,total_spots,price_per_person)
    values (f,'match','completed','2020-06-01','10:00',60,'7v7',14,5) returning id into gb;
  insert into public.game_players (game_id,user_id,reservation_id,status,amount,referred_by_user_id)
    values (gb,n2,r0,'confirmed',5,r2);

  -- T3: rental completed PREVIO + match referido posterior → r3 +0
  insert into public.games (field_id,type,status,date_key,time,duration_min,format,total_spots,price_per_person,booked_by_user_id)
    values (f,'rental','completed','2020-01-01','10:00',60,'7v7',14,5,n3) returning id into ga;
  insert into public.games (field_id,type,status,date_key,time,duration_min,format,total_spots,price_per_person)
    values (f,'match','completed','2020-06-01','10:00',60,'7v7',14,5) returning id into gb;
  insert into public.game_players (game_id,user_id,reservation_id,status,amount,referred_by_user_id)
    values (gb,n3,r0,'confirmed',5,r3);

  -- T4: rental RESERVED previo (inicio anterior) + match referido completed → 4a diferido
  insert into public.games (field_id,type,status,date_key,time,duration_min,format,total_spots,price_per_person,booked_by_user_id)
    values (f,'rental','reserved','2020-01-01','10:00',60,'7v7',14,5,n4) returning id into grent;
  insert into public.games (field_id,type,status,date_key,time,duration_min,format,total_spots,price_per_person)
    values (f,'match','completed','2020-06-01','10:00',60,'7v7',14,5) returning id into ga;
  insert into public.game_players (game_id,user_id,reservation_id,status,amount,referred_by_user_id)
    values (ga,n4,r0,'confirmed',5,r4);

  -- T5: match referido CANCELED → r5 +0
  insert into public.games (field_id,type,status,date_key,time,duration_min,format,total_spots,price_per_person)
    values (f,'match','canceled','2020-01-01','10:00',60,'7v7',14,5) returning id into gb;
  insert into public.game_players (game_id,user_id,reservation_id,status,amount,referred_by_user_id)
    values (gb,n5,r0,'confirmed',5,r5);

  -- T6: match referido NO completed (published) → r6 +0
  insert into public.games (field_id,type,status,date_key,time,duration_min,format,total_spots,price_per_person)
    values (f,'match','published','2020-01-01','10:00',60,'7v7',14,5) returning id into gb;
  insert into public.game_players (game_id,user_id,reservation_id,status,amount,referred_by_user_id)
    values (gb,n6,r0,'confirmed',5,r6);

  -- T7: autorreferido (referred_by = n7) → 0
  insert into public.games (field_id,type,status,date_key,time,duration_min,format,total_spots,price_per_person)
    values (f,'match','completed','2020-01-01','10:00',60,'7v7',14,5) returning id into gb;
  insert into public.game_players (game_id,user_id,reservation_id,status,amount,referred_by_user_id)
    values (gb,n7,r0,'confirmed',5,n7);

  -- T8: empate EXACTO date_key/time, dos games (distinto game_id), referrers distintos.
  --      Gana el game_id ASC menor → su referrer recibe S/5.
  insert into public.games (field_id,type,status,date_key,time,duration_min,format,total_spots,price_per_person)
    values (f,'match','completed','2020-03-03','12:00',60,'7v7',14,5) returning id into ga;
  insert into public.games (field_id,type,status,date_key,time,duration_min,format,total_spots,price_per_person)
    values (f,'match','completed','2020-03-03','12:00',60,'7v7',14,5) returning id into gb;
  insert into public.game_players (game_id,user_id,reservation_id,status,amount,referred_by_user_id)
    values (ga,n8,r0,'confirmed',5,r8a);
  insert into public.game_players (game_id,user_id,reservation_id,status,amount,referred_by_user_id)
    values (gb,n8,r0,'confirmed',5,r8b);
  if ga < gb then v_winner := r8a; v_loser := r8b; else v_winner := r8b; v_loser := r8a; end if;

  -- T9/10/11/12/13: montos por rol del referidor (player/captain/gold/both/changed)
  insert into public.games (field_id,type,status,date_key,time,duration_min,format,total_spots,price_per_person)
    values (f,'match','completed','2020-02-01','10:00',60,'7v7',14,5) returning id into gb;
  insert into public.game_players (game_id,user_id,reservation_id,status,amount,referred_by_user_id) values (gb,n9,r0,'confirmed',5,r9);
  insert into public.games (field_id,type,status,date_key,time,duration_min,format,total_spots,price_per_person)
    values (f,'match','completed','2020-02-01','10:00',60,'7v7',14,5) returning id into gb;
  insert into public.game_players (game_id,user_id,reservation_id,status,amount,referred_by_user_id) values (gb,n10,r0,'confirmed',5,r10);
  insert into public.games (field_id,type,status,date_key,time,duration_min,format,total_spots,price_per_person)
    values (f,'match','completed','2020-02-01','10:00',60,'7v7',14,5) returning id into gb;
  insert into public.game_players (game_id,user_id,reservation_id,status,amount,referred_by_user_id) values (gb,n11,r0,'confirmed',5,r11);
  insert into public.games (field_id,type,status,date_key,time,duration_min,format,total_spots,price_per_person)
    values (f,'match','completed','2020-02-01','10:00',60,'7v7',14,5) returning id into gb;
  insert into public.game_players (game_id,user_id,reservation_id,status,amount,referred_by_user_id) values (gb,n12,r0,'confirmed',5,r12);
  insert into public.games (field_id,type,status,date_key,time,duration_min,format,total_spots,price_per_person)
    values (f,'match','completed','2020-02-01','10:00',60,'7v7',14,5) returning id into gb;
  insert into public.game_players (game_id,user_id,reservation_id,status,amount,referred_by_user_id) values (gb,n13,r0,'confirmed',5,r13);

  -- ── Ejecutar la función REAL ──────────────────────────────────────────────
  perform public.process_referral_rewards();

  -- ── Assertions A/B ────────────────────────────────────────────────────────
  select reward_balance into v_bal from public.wallet_summary where user_id=r1;
  if v_bal <> 5 then raise exception 'T1 fail: r1 esperado 5, real %', v_bal; end if;
  if (select count(*) from public.reward_transactions where type='grant_referral' and referred_user_id=n1) <> 1
    then raise exception 'T1 fail: grants de n1 <> 1'; end if;

  if (select reward_balance from public.wallet_summary where user_id=r2) <> 0 then raise exception 'T2 fail: r2 debe ser 0'; end if;
  if (select reward_balance from public.wallet_summary where user_id=r3) <> 0 then raise exception 'T3 fail: r3 debe ser 0'; end if;

  -- T4a: diferido → r4 0 y fila de n4 SIN marcar
  if (select reward_balance from public.wallet_summary where user_id=r4) <> 0 then raise exception 'T4a fail: r4 debe ser 0 (diferido)'; end if;
  select referral_reward_evaluated_at into v_eval from public.game_players where game_id=ga and user_id=n4;
  if v_eval is not null then raise exception 'T4a fail: la fila de n4 no debe quedar marcada (diferida)'; end if;

  if (select reward_balance from public.wallet_summary where user_id=r5) <> 0 then raise exception 'T5 fail: r5 debe ser 0'; end if;
  if (select reward_balance from public.wallet_summary where user_id=r6) <> 0 then raise exception 'T6 fail: r6 debe ser 0'; end if;
  if (select count(*) from public.reward_transactions where referred_user_id=n7) <> 0 then raise exception 'T7 fail: autorreferido no debe generar grant'; end if;

  -- T8: gana el game_id menor
  if (select reward_balance from public.wallet_summary where user_id=v_winner) <> 5 then raise exception 'T8 fail: winner esperado 5'; end if;
  if (select reward_balance from public.wallet_summary where user_id=v_loser)  <> 0 then raise exception 'T8 fail: loser esperado 0'; end if;
  if (select count(*) from public.reward_transactions where type='grant_referral' and referred_user_id=n8) <> 1 then raise exception 'T8 fail: n8 debe tener exactamente 1 grant'; end if;

  -- T9-13: montos por rol
  if (select reward_balance from public.wallet_summary where user_id=r9)  <> 5  then raise exception 'T9 fail: player esperado 5';        end if;
  if (select reward_balance from public.wallet_summary where user_id=r10) <> 8  then raise exception 'T10 fail: captain esperado 8';       end if;
  if (select reward_balance from public.wallet_summary where user_id=r11) <> 10 then raise exception 'T11 fail: gold esperado 10';         end if;
  if (select reward_balance from public.wallet_summary where user_id=r12) <> 10 then raise exception 'T12 fail: captain+gold esperado 10'; end if;
  if (select reward_balance from public.wallet_summary where user_id=r13) <> 10 then raise exception 'T13 fail: rol vigente (gold) esperado 10'; end if;

  -- ── Idempotencia (C): re-ejecutar 2 veces, nada cambia ────────────────────
  perform public.process_referral_rewards();
  perform public.process_referral_rewards();
  if (select reward_balance from public.wallet_summary where user_id=r1)  <> 5  then raise exception 'T14/16 fail: r1 cambió tras re-run'; end if;
  if (select reward_balance from public.wallet_summary where user_id=r11) <> 10 then raise exception 'T14/16 fail: r11 cambió tras re-run'; end if;
  if exists (select 1 from public.reward_transactions
             where type='grant_referral' and referred_user_id in (n1,n8,n9,n10,n11,n12,n13)
             group by referred_user_id having count(*) > 1)
    then raise exception 'T15 fail: algún referred_user tiene >1 grant_referral'; end if;

  -- ── T4b: cancelar el rental reserved → ahora sí recompensa ────────────────
  update public.games set status='canceled' where id=grent;
  perform public.process_referral_rewards();
  if (select reward_balance from public.wallet_summary where user_id=r4) <> 5 then raise exception 'T4b fail: tras cancelar el rental, r4 esperado 5'; end if;
  if (select count(*) from public.reward_transactions where type='grant_referral' and referred_user_id=n4) <> 1 then raise exception 'T4b fail: n4 debe tener exactamente 1 grant'; end if;

  -- ── Invariantes (E) ───────────────────────────────────────────────────────
  if exists (select 1 from public.wallet_summary
             where user_id in (r1,r2,r3,r4,r5,r6,r8a,r8b,r9,r10,r11,r12,r13)
               and total_amount is distinct from (reserved_balance + credit_balance))
    then raise exception 'E fail: invariante total=reserved+credit roto'; end if;
  if exists (select 1 from public.wallet_summary
             where user_id in (r1,r2,r3,r4,r5,r6,r8a,r8b,r9,r10,r11,r12,r13,n7)
               and (total_amount<>100 or reserved_balance<>60 or credit_balance<>40))
    then raise exception 'E fail: Rewards alteró total/reserved/credit'; end if;
  if exists (select 1 from public.wallet_summary where reward_balance < 0)
    then raise exception 'E fail: reward_balance negativo'; end if;
  select count(*) into v_cnt from public.reward_transactions
   where type='grant_referral'
     and referred_user_id in (n1,n2,n3,n4,n5,n6,n7,n8,n9,n10,n11,n12,n13);
  if v_cnt <> 8 then raise exception 'E fail: se esperaban 8 grants entre fixtures, hay %', v_cnt; end if;

  raise notice 'SUITE 1 (A/B/C/E) PASS';
end $$;
rollback;


-- ════════════════════════════════════════════════════════════════════════════
-- SUITE 2 · No retroactividad (OFF / amount=0). Modifica app_settings → ROLLBACK
-- ════════════════════════════════════════════════════════════════════════════
begin;
do $$
declare
  f uuid; ganchor uuid; r0 uuid;
  rD1 uuid; nD1 uuid; rD2 uuid; nD2 uuid; g uuid; v_eval timestamptz;
begin
  if session_user <> 'postgres' then raise exception 'Ejecuta como postgres (session_user=%)', session_user; end if;

  insert into public.fields (name, format, total_spots, duration_min) values ('ZZTEST_FIELD_D','7v7',14,60) returning id into f;
  insert into public.games (field_id,type,status,date_key,time,duration_min,format,total_spots,price_per_person)
    values (f,'match','published','2019-01-01','10:00',60,'7v7',14,5) returning id into ganchor;
  insert into public.reservations (game_id) values (ganchor) returning id into r0;

  insert into public.users (full_name) values ('ZZ rD1'),('ZZ nD1'),('ZZ rD2'),('ZZ nD2');
  select id into rD1 from public.users where full_name='ZZ rD1';
  select id into nD1 from public.users where full_name='ZZ nD1';
  select id into rD2 from public.users where full_name='ZZ rD2';
  select id into nD2 from public.users where full_name='ZZ nD2';
  insert into public.wallet_summary (user_id,total_amount,reserved_balance,credit_balance,reward_balance)
  select uid,0,0,0,0 from unnest(array[rD1,rD2]) uid;

  -- ── T17: config player OFF al evaluar → 0 reward y fila MARCADA ────────────
  update public.app_settings set reward_referral_player_enabled=false, reward_referral_player_amount=5 where id=1;
  insert into public.games (field_id,type,status,date_key,time,duration_min,format,total_spots,price_per_person)
    values (f,'match','completed','2020-01-01','10:00',60,'7v7',14,5) returning id into g;
  insert into public.game_players (game_id,user_id,reservation_id,status,amount,referred_by_user_id)
    values (g,nD1,r0,'confirmed',5,rD1);
  perform public.process_referral_rewards();
  if (select reward_balance from public.wallet_summary where user_id=rD1) <> 0 then raise exception 'T17 fail: OFF no debe pagar'; end if;
  select referral_reward_evaluated_at into v_eval from public.game_players where game_id=g and user_id=nD1;
  if v_eval is null then raise exception 'T17 fail: la oportunidad debe quedar MARCADA aunque OFF'; end if;

  -- ── T18: OFF → ON posteriormente → NO backfill ────────────────────────────
  update public.app_settings set reward_referral_player_enabled=true, reward_referral_player_amount=5 where id=1;
  perform public.process_referral_rewards();
  if (select reward_balance from public.wallet_summary where user_id=rD1) <> 0 then raise exception 'T18 fail: backfill indebido tras OFF→ON'; end if;
  if (select count(*) from public.reward_transactions where type='grant_referral' and referred_user_id=nD1) <> 0 then raise exception 'T18 fail: no debe existir grant para nD1'; end if;

  -- ── T19: amount=0 al evaluar → 0 reward y fila MARCADA ────────────────────
  update public.app_settings set reward_referral_player_enabled=true, reward_referral_player_amount=0 where id=1;
  insert into public.games (field_id,type,status,date_key,time,duration_min,format,total_spots,price_per_person)
    values (f,'match','completed','2020-01-01','10:00',60,'7v7',14,5) returning id into g;
  insert into public.game_players (game_id,user_id,reservation_id,status,amount,referred_by_user_id)
    values (g,nD2,r0,'confirmed',5,rD2);
  perform public.process_referral_rewards();
  if (select reward_balance from public.wallet_summary where user_id=rD2) <> 0 then raise exception 'T19 fail: amount=0 no debe pagar'; end if;
  select referral_reward_evaluated_at into v_eval from public.game_players where game_id=g and user_id=nD2;
  if v_eval is null then raise exception 'T19 fail: oportunidad debe quedar MARCADA con amount=0'; end if;

  -- ── T20: amount 0 → positivo → NO backfill ────────────────────────────────
  update public.app_settings set reward_referral_player_amount=5 where id=1;
  perform public.process_referral_rewards();
  if (select reward_balance from public.wallet_summary where user_id=rD2) <> 0 then raise exception 'T20 fail: backfill indebido tras amount 0→positivo'; end if;
  if (select count(*) from public.reward_transactions where type='grant_referral' and referred_user_id=nD2) <> 0 then raise exception 'T20 fail: no debe existir grant para nD2'; end if;

  raise notice 'SUITE 2 (D) PASS';
end $$;
rollback;
