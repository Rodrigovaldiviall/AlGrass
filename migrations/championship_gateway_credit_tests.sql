-- ══════════════════════════════════════════════════════════════════════════════
-- PRUEBA · Crédito en la compra inicial del App (pasarela) · SE DESHACE SOLA
-- ══════════════════════════════════════════════════════════════════════════════
-- Ejercita create_championship_gateway_order (+ confirm) contra Supabase de verdad,
-- dentro de UNA transacción que termina en `rollback`: no queda campeonato, order,
-- asiento ni un céntimo movido del wallet.
--
--   1 · crédito 0        → order pending, snapshot credit_applied=0, external=bruto,
--                          provider NULL, método 'gateway'; wallet SIN cambio.
--   2 · crédito parcial  → débito del crédito al crear; snapshot credit_applied=C,
--                          external=bruto−C; al confirmar entra external; asiento
--                          con el BRUTO y credit_applied=C.
--   3 · crédito 100%     → external=0, método/provider 'credit'; débito del total al
--                          crear; al confirmar NO entra nada externo; asiento BRUTO.
--   4 · abandono (fail)  → restitución íntegra del crédito (pending→failed).
--
-- El INVARIANTE del wallet (total − (reserved+credit)) se vigila en varios pasos: no
-- debe cambiar nunca, empiece cuadrada o no la fila del usuario (v_desc0 = desajuste
-- de partida, que se conserva).
--
-- CÓMO SE CORRE: aplica antes 20261103120000_championship_credit_core.sql y
-- championship_gateway_credit.sql. Pega el fichero entero en el editor SQL. «TODAS
-- LAS PRUEBAS OK» al final = pasaron todas.
-- ══════════════════════════════════════════════════════════════════════════════

begin;

do $prueba$
declare
  v_user  uuid := 'ebc018a9-40f1-449d-8fc5-d2baaa9e343b';  -- usuario normal: dueño y pagador (auth.uid())
  v_city  text := 'Arequipa';
  v_venue uuid;  v_field uuid;
  v_g1 uuid; v_g2 uuid; v_g3 uuid; v_g4 uuid;
  v_group text;
  v_total numeric;  v_half numeric;
  v_champ public.championships%rowtype;
  v_cred0 numeric; v_resv0 numeric; v_tot0 numeric; v_desc0 numeric;
  v_cred numeric; v_resv numeric; v_tot numeric;
  v_snap jsonb; v_n int; v_num numeric; v_ca numeric;
begin
  -- ── Fixtures: sede, cancha, 4 rentals a +60 días (fuera de la antelación mínima) ──
  insert into public.venues (name, city, address) values ('ZZ Gateway credito', v_city, 'Calle prueba') returning id into v_venue;
  insert into public.fields (venue_id, name, format) values (v_venue, 'Cancha prueba', '7v7') returning id into v_field;
  insert into public.games (field_id, type, date_key, time, duration_min, status, price_total)
    values (v_field, 'rental', (current_date + 60), '19:00', 60, 'published', 300) returning id into v_g1;
  insert into public.games (field_id, type, date_key, time, duration_min, status, price_total)
    values (v_field, 'rental', (current_date + 60), '20:00', 60, 'published', 300) returning id into v_g2;
  insert into public.games (field_id, type, date_key, time, duration_min, status, price_total)
    values (v_field, 'rental', (current_date + 61), '19:00', 60, 'published', 300) returning id into v_g3;
  insert into public.games (field_id, type, date_key, time, duration_min, status, price_total)
    values (v_field, 'rental', (current_date + 61), '20:00', 60, 'published', 300) returning id into v_g4;

  if not exists (select 1 from public.championship_settings where city = v_city and active = true) then
    raise exception 'FALLO: % no tiene tarifas activas; el gateway no podría cotizar', v_city;
  end if;
  -- Un group_id válido de la ciudad (clave de availability_formats): el precio y el lead salen de ahí.
  select key into v_group
    from public.championship_settings s, jsonb_object_keys(s.availability_formats) key
   where s.city = v_city and s.active = true limit 1;
  if v_group is null then raise exception 'FALLO: % no tiene availability_formats', v_city; end if;

  -- Saldo de partida: crédito suficiente.
  insert into public.wallet_summary (user_id, total_amount, reserved_balance, credit_balance)
    values (v_user, 0, 0, 0) on conflict (user_id) do nothing;
  update public.wallet_summary set credit_balance = credit_balance + 5000, total_amount = total_amount + 5000
   where user_id = v_user;
  select credit_balance, reserved_balance, total_amount into v_cred0, v_resv0, v_tot0
    from public.wallet_summary where user_id = v_user;
  v_desc0 := round(v_tot0 - (v_resv0 + v_cred0), 2);

  -- Actor = el usuario (el gateway usa auth.uid()).
  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  -- Bruto cotizado por el backend (misma fn que el quote del App).
  v_total := (public._championship_compute_price(array[v_g1], v_group, '[]'::jsonb)->>'amount_total')::numeric;
  if v_total is null or v_total <= 0 then raise exception 'FALLO: cotización no utilizable: %', v_total; end if;
  v_half := round(v_total / 2, 2);

  -- ╔═ 1 · CRÉDITO 0 — comportamiento de hoy ═╗
  v_champ := public.create_championship_gateway_order(array[v_g1], 'test_cr_0',
    jsonb_build_object('group_id', v_group));
  select financial_snapshot into v_snap from public.orders where id = v_champ.order_id;
  if (v_snap->>'credit_applied')::numeric <> 0 then raise exception 'FALLO[0]: credit_applied no es 0'; end if;
  if (v_snap->>'external_amount')::numeric <> v_total then raise exception 'FALLO[0]: external no es el bruto'; end if;
  if v_champ.payment_method <> 'gateway' then raise exception 'FALLO[0]: método no es gateway'; end if;
  if (select payment_provider from public.orders where id = v_champ.order_id) is not null then
    raise exception 'FALLO[0]: provider debería ser NULL sin método explícito'; end if;
  if (select amount_total from public.orders where id = v_champ.order_id) <> v_total then
    raise exception 'FALLO[0]: amount_total no es el bruto'; end if;
  select credit_balance, reserved_balance, total_amount into v_cred, v_resv, v_tot from public.wallet_summary where user_id = v_user;
  if round(v_tot - (v_resv + v_cred), 2) <> v_desc0 then raise exception 'FALLO[0]: invariante roto'; end if;
  if v_cred <> v_cred0 then raise exception 'FALLO[0]: sin crédito el wallet no debe moverse'; end if;

  -- ╔═ 2 · CRÉDITO PARCIAL ═╗
  v_champ := public.create_championship_gateway_order(array[v_g2], 'test_cr_part',
    jsonb_build_object('group_id', v_group, 'credit_applied', v_half));
  select financial_snapshot into v_snap from public.orders where id = v_champ.order_id;
  if (v_snap->>'credit_applied')::numeric <> v_half then raise exception 'FALLO[parcial]: credit_applied != %', v_half; end if;
  if (v_snap->>'external_amount')::numeric <> round(v_total - v_half, 2) then raise exception 'FALLO[parcial]: external mal'; end if;
  if (select amount_total from public.orders where id = v_champ.order_id) <> v_total then
    raise exception 'FALLO[parcial]: amount_total no es el bruto'; end if;
  select credit_balance, reserved_balance, total_amount into v_cred, v_resv, v_tot from public.wallet_summary where user_id = v_user;
  if round(v_cred0 - v_cred, 2) <> v_half then raise exception 'FALLO[parcial]: no debitó el crédito (% vs %)', round(v_cred0 - v_cred,2), v_half; end if;
  if round(v_tot - (v_resv + v_cred), 2) <> v_desc0 then raise exception 'FALLO[parcial]: invariante roto tras débito'; end if;
  perform public.confirm_championship_gateway_payment(v_champ.id);
  select count(*), coalesce(max(total_amount),0), coalesce(max(credit_applied),0) into v_n, v_num, v_ca
    from public.reservations where championship_id = v_champ.id and status = 'spend';
  if v_n <> 1 then raise exception 'FALLO[parcial]: debería haber 1 asiento, hay %', v_n; end if;
  if v_num <> v_total then raise exception 'FALLO[parcial]: asiento no lleva el bruto'; end if;
  if v_ca <> v_half then raise exception 'FALLO[parcial]: asiento no refleja el crédito'; end if;
  select credit_balance, reserved_balance, total_amount into v_cred, v_resv, v_tot from public.wallet_summary where user_id = v_user;
  if round(v_tot - (v_resv + v_cred), 2) <> v_desc0 then raise exception 'FALLO[parcial]: invariante roto tras confirmar'; end if;

  -- ╔═ 3 · CRÉDITO 100% ═╗
  v_champ := public.create_championship_gateway_order(array[v_g3], 'test_cr_full',
    jsonb_build_object('group_id', v_group, 'credit_applied', v_total));
  select financial_snapshot into v_snap from public.orders where id = v_champ.order_id;
  if (v_snap->>'external_amount')::numeric <> 0 then raise exception 'FALLO[100]: external no es 0'; end if;
  if v_champ.payment_method <> 'credit' then raise exception 'FALLO[100]: método no es credit'; end if;
  if (select payment_provider from public.orders where id = v_champ.order_id) <> 'credit' then
    raise exception 'FALLO[100]: provider no es credit'; end if;
  select credit_balance, reserved_balance, total_amount into v_cred, v_resv, v_tot from public.wallet_summary where user_id = v_user;
  if round(v_tot - (v_resv + v_cred), 2) <> v_desc0 then raise exception 'FALLO[100]: invariante roto tras débito'; end if;
  perform public.confirm_championship_gateway_payment(v_champ.id);
  if (select status from public.orders where id = v_champ.order_id) <> 'confirmed' then
    raise exception 'FALLO[100]: order no quedó confirmed'; end if;
  select coalesce(max(credit_applied),0) into v_ca from public.reservations
    where championship_id = v_champ.id and status = 'spend';
  if v_ca <> v_total then raise exception 'FALLO[100]: asiento no refleja el crédito total'; end if;
  select credit_balance, reserved_balance, total_amount into v_cred, v_resv, v_tot from public.wallet_summary where user_id = v_user;
  if round(v_tot - (v_resv + v_cred), 2) <> v_desc0 then raise exception 'FALLO[100]: invariante roto tras confirmar'; end if;

  -- ╔═ 4 · ABANDONO → restitución ═╗
  v_champ := public.create_championship_gateway_order(array[v_g4], 'test_cr_fail',
    jsonb_build_object('group_id', v_group, 'credit_applied', v_half));
  perform public.fail_championship_gateway(v_champ.id, 'test');
  select credit_balance, reserved_balance, total_amount into v_cred, v_resv, v_tot from public.wallet_summary where user_id = v_user;
  if round(v_tot - (v_resv + v_cred), 2) <> v_desc0 then raise exception 'FALLO[fail]: invariante roto tras restituir'; end if;
  -- Tras el fail, el crédito del camino 4 vuelve: el único consumido permanente es el de 2 (parcial) y 3 (100%).
  if round(v_cred0 - v_cred, 2) <> round(v_half + v_total, 2) then
    raise exception 'FALLO[fail]: crédito consumido neto % esperado %', round(v_cred0 - v_cred,2), round(v_half + v_total,2);
  end if;

  raise notice 'TODAS LAS PRUEBAS OK (gateway credito: 0 / parcial / 100%% / restitucion).';
end;
$prueba$;

rollback;
