# Auditoría de seguridad y eficiencia — rama `v23`
- **Repo:** Rodrigovaldiviall/AlGrass · **Commit auditado:** `73de0a2` (v23)
- **Alcance:** `src/`, `supabase/functions/`, `migrations/` (152), `full.sql`, config de build/deploy. Solo lectura; no se modificó código.
- **Método:** 7 auditores por área (SQL/RLS, rendimiento SQL, Edge Function, services, pantallas-seguridad, pantallas-rendimiento, build). Cada hallazgo pasó por un verificador adversarial que intentó refutarlo y recalibró la severidad. Quedaron 107 hallazgos confirmados, que se agruparon en 84 ítems únicos; los 4 refutados se listan al final.
| Severidad | Ítems |
|---|---|
| Crítico | 9 |
| Alto | 11 |
| Medio | 24 |
| Bajo | 40 |

> **Advertencia sobre `full.sql`:** varios hallazgos de RLS/GRANT se basan en `full.sql` (volcado de esquema). Los verificadores detectaron que está **desactualizado** respecto al código (p. ej. faltan columnas de `game_players`), y algunas tablas (`wallet_summary`, `apply_wallet_refund`) no tienen DDL en el repo. **Antes de aplicar fixes, confirmar en producción** con `select * from pg_policies`, `\dp public.*` y `\df+ public.apply_wallet_refund`. Si producción coincide con `full.sql`, la severidad indicada aplica.

## Resumen ejecutivo (acciones prioritarias)

1. **Dinero:** cerrar las vías desde el cliente para acuñar crédito: `apply_wallet_refund` ejecutable por anon/authenticated, `wallet_summary` editable, ledger `reservations` y `game_players.amount` escribibles. Mover todo cálculo de importes y escrituras del ledger a RPCs `SECURITY DEFINER` o Edge Functions con service_role, y revocar INSERT/UPDATE directos.
2. **Pagos:** `create_order` y `confirm_order` confían en el importe y en el `financial_snapshot` del cliente. Las RPC de confirmación de campeonatos y alquileres no verifican pago. Hay que recalcular el precio en el servidor y exigir verificación con el proveedor (webhook firmado) antes de pasar a `confirmed`.
3. **Datos personales:** `users_select_public USING(true)` y las tablas sin RLS (`games`, `rating`, `credit_transactions`) con `GRANT ALL` a anon.
4. **Endurecimiento global:** retirar `ALTER DEFAULT PRIVILEGES` a anon, fijar `search_path` en funciones DEFINER y añadir cabeceras de seguridad en `vercel.json`.
5. **Eficiencia:** índices en FK y en columnas de filtro de RLS, paginación de listados, consolidar las consultas de Profile, PickupGames y los badges globales, y hacer atómica la materialización en `confirm_order`.

## Crítico

### 1. apply_wallet_refund (sin DDL en el repo) es invocada desde el cliente con importe arbitrario
- **Categoría:** seguridad
- **Ubicación:** `src/services/reservationService.js:39`, `full.sql:1216`
- **Detectado por 3 auditores independientes**

**Evidencia:** reservationService.js:37-40: `async function applyRefund(userId, refundAmount) { // RPC with SECURITY DEFINER: bypasses RLS for cross-user refunds ... await supabase.rpc('apply_wallet_refund', { p_user_id: userId, p_amount: refundAmount }); }`. Ningún archivo de migrations/ define apply_wallet_refund; cancel_match_invited_refund_zero.sql:193 la usa como primitiva.

**Impacto:** Cualquier usuario autenticado puede abrir la consola y ejecutar supabase.rpc('apply_wallet_refund', { p_user_id: <cualquier uuid>, p_amount: 100000 }) usando la anon key pública. Así se acredita saldo de wallet (credit_balance) a sí mismo o a cualquier cuenta, ese saldo se gasta en reservas o campeonatos y el negocio pierde dinero. Además, el importe de los reembolsos legítimos lo decide el cliente: si se manipulan game_players.amount o la regla de 24h en el navegador, el reembolso sale inflado. Si en algún momento no se revocó EXECUTE a anon, cualquiera podría hacerlo incluso sin cuenta.

**Fix propuesto:** 1) Versionar apply_wallet_refund en migrations/ y ejecutar `revoke all on function public.apply_wallet_refund(uuid, numeric) from public, anon, authenticated;`, dejándola solo como primitiva interna para otras funciones SECURITY DEFINER. 2) Llevar cancelGamePlayer y cancelGuestPlayers a RPCs SQL (por ejemplo cancel_game_player(p_game_id, p_player_id) y cancel_guest_players(p_game_id)) que se ejecuten como SECURITY DEFINER con search_path fijo. Estas RPCs deben comprobar con auth.uid() que quien llama es el jugador o su pagador, calcular el importe en el servidor a partir de game_players.amount y de la ventana de cancelación del servidor, insertar la fila 'refund' del ledger y llamar a apply_wallet_refund en la misma transacción. 3) Quitar el INSERT directo de reservations con status='refund' desde el cliente: añadir una política RLS o un trigger que lo rechace para authenticated. Para impedir que un mismo reembolso se aplique dos veces, crear un índice UNIQUE (game_id, user_id, status) o una referencia al game_player cancelado. 4) Revisar los ALTER DEFAULT PRIVILEGES (full.sql:904-905) para que las funciones nuevas no reciban EXECUTE de anon y authenticated por defecto.

_Hallazgos relacionados que se fusionaron aquí:_ RPC apply_wallet_refund invocable desde el cliente con usuario y monto arbitrarios (acuñación de crédito); RPC SECURITY DEFINER apply_wallet_refund ejecutable por anon/authenticated sin validación: cualquiera puede acreditarse saldo

### 2. applySpend/ensureWalletSummary escriben wallet_summary (credit_balance) desde el navegador
- **Categoría:** seguridad
- **Ubicación:** `src/services/reservationService.js:34`, `full.sql:1199`, `src/services/reservationService.js:21`
- **Detectado por 3 auditores independientes**

**Evidencia:** const next = { user_id, total_amount: cur.total_amount + totalAmount, reserved_balance: ..., credit_balance: Math.max(0, cur.credit_balance - creditApplied) }; await db.from('wallet_summary').upsert(next, { onConflict: 'user_id' }); (líneas 21-35) y insert en línea 16. El camino interno lo ejecuta con el cliente anon+JWT: ConfirmReservation.jsx:1270 materializeReservation({ db: supabase, actor: authUser?.id }, ...). El comentario de la línea 20 admite 'Race condition acceptable'.

**Impacto:** Cualquier usuario autenticado puede ejecutar desde la consola del navegador supabase.from('wallet_summary').upsert({user_id: <su uid>, credit_balance: 100000, total_amount: 100000, reserved_balance: 0}, {onConflict: 'user_id'}). Así se fabrica crédito y con él puede: (1) reservar partidos y alquileres por el camino interno de 100% crédito (ConfirmReservation.jsx:1270), (2) pasar la validación INSUFFICIENT_CREDIT de confirm_order, que lee esa misma columna manipulada (supabase/functions/confirm_order/index.ts:110-116), y (3) inscribirse en campeonatos con spend_wallet_credit. Además puede saltarse por completo el débito: si llama a reserve_slots/insert sin applySpend, reserva sin que se le descuente nada. Con creditApplied negativo, el propio applySpend incrementa el crédito. Si alguna vez se reembolsa crédito en efectivo, esto es fraude monetario directo. Por último, dos checkouts concurrentes leen el mismo saldo y se pierde una de las actualizaciones, lo que permite gastar dos veces el mismo saldo.

**Fix propuesto:** 1) En Supabase: REVOKE INSERT, UPDATE, DELETE ON public.wallet_summary FROM anon, authenticated, y dejar solo una política SELECT USING (user_id = auth.uid()). Versionar esa DDL y las políticas en migrations/ (hoy no existen en el repo). 2) Reemplazar applySpend por una RPC SECURITY DEFINER atómica que valide el monto, haga UPDATE public.wallet_summary SET credit_balance = credit_balance - p_credit, reserved_balance = reserved_balance + p_sub, total_amount = total_amount + p_total WHERE user_id = auth.uid() AND p_credit >= 0 AND credit_balance >= p_credit RETURNING ..., y falle con INSUFFICIENT_CREDIT si no se actualiza ninguna fila. Mejor aún: mover todo el camino interno de 100% crédito a confirm_order o a una RPC que cree la reserva y debite en la misma transacción, y calcule el monto en el servidor a partir del precio del juego, nunca del snapshot del cliente. 3) Crear la fila de wallet_summary con un trigger AFTER INSERT en users/profiles (o con INSERT ... ON CONFLICT DO NOTHING dentro de la RPC) y quitar ensureWalletSummary del cliente (líneas 12-18, 74, 85). 4) Auditar los saldos actuales contra el ledger (wallet_transactions/reservations) para detectar filas ya manipuladas.

_Hallazgos relacionados que se fusionaron aquí:_ Política RLS wallet_summary_update_own permite al usuario reescribir su propio credit_balance; wallet_summary sin DDL/RLS versionada y actualizada con read-modify-write desde el cliente (lost update)

### 3. Usuario puede inflar sus reembolsos editando/insertando filas 'spend' en reservations
- **Categoría:** seguridad
- **Ubicación:** `full.sql:540`, `migrations/cancellation_windows_from_app_settings.sql:198`, `src/services/reservationService.js:465`
- **Detectado por 3 auditores independientes**

**Evidencia:** `CREATE POLICY "Users can update own reservations" ON public.reservations FOR UPDATE TO authenticated USING (auth.uid() = user_id);` sin WITH CHECK ni restricción de columnas; además `reservations_insert_own` (l.567) y `users can insert own reservations` (l.578) permiten INSERT con cualquier status/importe, y GRANT ALL a anon/authenticated (l.857-859). Ninguna migración elimina estas policies. cancel_rental_self calcula el reembolso desde ese ledger: `select r.id, coalesce(r.subtotal_amount, r.total_amount, 0) ... where r.user_id = v_actor and r.status = 'spend'` (migrations/rental_cancellation.sql:155-161) y luego `perform public.apply_wallet_refund(v_actor, v_refund)` (l.181).

**Impacto:** Un usuario autenticado con un rental en estado 'reserved' que aún no ha empezado puede inflar su reembolso. Vía PostgREST, con la anon key pública y su JWT, ejecuta `PATCH /reservations?id=eq.<su spend>` con `{"subtotal_amount": 99999}`, o hace `POST /reservations` para insertar un 'spend' falso con game_id = su rental y un reserved_at más reciente. Después llama a `rpc/cancel_rental_self` dentro de la ventana del 100%. apply_wallet_refund le abona 99999 de crédito real en su wallet, que luego puede gastar en partidos y campeonatos.

Con esas mismas policies también puede reescribir status, total_amount, canceled_at y demás campos de sus filas históricas. Eso corrompe el ledger contable y los reportes. Es fraude económico directo, explotable ahora mismo.

**Fix propuesto:** 1) Mover las escrituras del ledger a RPCs SECURITY DEFINER que calculen los importes en el servidor (a partir de games/orders), y adaptar src/services/reservationService.js (l.301, 321, 465, 611, 784) para que use esas RPCs en lugar de `.from('reservations').insert`.
2) En una migración: `drop policy "Users can update own reservations" on public.reservations; drop policy reservations_insert_own on public.reservations; drop policy "users can insert own reservations" on public.reservations; revoke insert, update, delete on public.reservations from anon, authenticated; revoke all on public.reservations from anon;`. Conservar una sola policy SELECT (eliminar la duplicada "users can read own reservations").
3) Defensa en profundidad: que cancel_rental_self (cancellation_windows_from_app_settings.sql:198) tome el importe bruto de la tabla orders pagada y vinculada al game/usuario (o lo acote con min(subtotal, precio del game)), no de una fila del ledger que el cliente puede escribir. Revisar con el mismo criterio cancel_match y cancel_rental.
4) Comprobar el estado real en producción con `select * from pg_policies where tablename='reservations'` y `\dp public.reservations`, y auditar en el histórico las filas 'spend' con subtotal_amount anómalo o sin order asociada.

_Hallazgos relacionados que se fusionaron aquí:_ Reembolso de rental calculado sobre reservations.subtotal_amount, que el cliente puede insertar o editar; Ledger de reembolsos (reservations status='refund') escrito por el cliente con montos calculados en el navegador

### 4. Política users_select_public USING(true) expone PII de todos los usuarios a anon
- **Categoría:** seguridad
- **Ubicación:** `full.sql:586`
- **Detectado por 2 auditores independientes**

**Evidencia:** `CREATE POLICY "users_select_public" ON public.users FOR SELECT USING (true);` + `GRANT ALL ON TABLE public.users TO anon` (l.863). users contiene email, phone, birth_date, sex, nationality, occupation (l.317-333) y luego address_city/address_line/district y confirmed_email (migrations/users_captain_address.sql:29-36, users_confirmed_email.sql:13). migrations/users_public_view.sql:4 dice 'se cierra en una migración posterior' pero ninguna migración la elimina; el cliente aún lee otros usuarios desde users (src/components/RewardsSheet.jsx:73).

**Impacto:** Cualquier persona, incluso sin cuenta, puede usar la anon key pública del bundle para pedir `GET /rest/v1/users?select=email,phone,birth_date,sex,nationality,occupation,address_line,address_city,credit_balance` y descargar paginada la base completa de usuarios. Es una fuga masiva de datos personales (contacto, domicilio, fecha de nacimiento, saldo), útil para phishing o suplantación y con riesgo legal bajo la Ley 29733 de Perú (protección de datos personales). Contradice además el diseño declarado del proyecto, según el cual users_public es la única superficie pública.

**Fix propuesto:** Crear una nueva migración (por ejemplo migrations/users_close_select_public.sql) con lo siguiente: `drop policy if exists "users_select_public" on public.users; create policy users_select_own on public.users for select to authenticated using (id = (select auth.uid()));` y además `revoke all on public.users from anon;`. Cerrar también el acceso de staff/admin si lo necesitan mediante una política basada en _is_algrass_staff. Antes de aplicarla, migrar las lecturas de terceros a la vista users_public: src/components/RewardsSheet.jsx:73, src/services/reservationService.js:115 y src/utils/format.js:55 (verificar que solo lean id/full_name de otros usuarios). Las lecturas propias, como Profile.jsx:2443 o championshipRequestService.js:80 con el id de la sesión, siguen funcionando con users_select_own. Después, regenerar full.sql y probar con la anon key que `/rest/v1/users` devuelve [].

_Hallazgos relacionados que se fusionaron aquí:_ Lectura directa de la tabla users de otro usuario: depende de users_select_public USING (true) que expone email, teléfono y fecha de nacimiento

### 5. Se confía en financial_snapshot provisto por el cliente (precios, creditApplied, gameId, invitados) sin recomputar ni validar
- **Categoría:** seguridad
- **Ubicación:** `supabase/functions/confirm_order/index.ts:138`, `migrations/restore_create_order_double_out_pending_guard.sql:68`, `migrations/create_order_championship_gateway_guard.sql:199`
- **Detectado por 4 auditores independientes**

**Evidencia:** const snapshot = { ...order.financial_snapshot, source }; → materializeReservation(ctx, snapshot) (L141). El snapshot proviene tal cual de p_financial_snapshot en create_order (migrations/create_order_championship_gateway_guard.sql L199) y create_order solo valida p_amount_total >= 0 (L68). En modo crédito (L108-115) se compara saldo contra snapshot.creditApplied, que también controla el cliente.

**Impacto:** Cualquier usuario autenticado puede llamar a create_order con payment_provider='credit', amount_total=0 y un snapshot con creditApplied=0, totalAmount=0 y unitPrice=0, y luego a confirm_order. La comprobación de saldo pasa (0 < 0 es falso), applySpend descuenta 0 y la reserva queda confirmada gratis: pérdida económica directa. Como snapshot.gameId no se compara con order.resource_id, el HOLD y la validación de capacidad se hacen sobre un partido y la inscripción se hace en otro (por ejemplo uno lleno o ajeno). Lo único que lo limita es el trigger de capacidad de game_players, que sigue aplicando en el partido de destino. Con guests[].id arbitrarios se inscribe a otros usuarios en partidos usando service-role y se les envían notificaciones 'invited_by_player' con un texto que también controla el atacante (payerName). Con hostUserId arbitrario se esquiva el bloqueo del organizador en createGamePlayer. Con titularNet, promoDiscount, subtotalAmount y rewardApplied arbitrarios se corrompen el ledger de reservations y los importes de reembolso.

**Fix propuesto:** 1) En create_order (SECURITY DEFINER), dejar de aceptar el snapshot económico del cliente. El servidor debe calcular unitPrice, subtotal, promoDiscount (validando promo_codes), creditApplied y total a partir de games/venues/promo_codes, fijar amount_total con ese cálculo y guardar ese snapshot. Del cliente solo se acepta la intención: guests, reserved_slots, promoCode y referral. 2) En confirm_order, antes de L141, rechazar con 409 si snapshot.gameId !== order.resource_id o si Number(snapshot.totalAmount) !== Number(order.amount_total). En modo crédito, exigir que creditApplied === amount_total y que amount_total sea mayor que 0 cuando el partido tiene precio (salvo invitación). 3) Construir el snapshot que se pasa a materializeReservation con una lista blanca de campos: hostUserId y venueId leídos de games, payerName de profiles, y guests validados (ids de profiles existentes, sin duplicados, distintos del pagador, cantidad igual a claim_composition.guests y relación de amistad/permiso). reservedSlots debe ser igual a claim_composition.reserved_slots. 4) Validar rewardApplied contra el saldo de rewards dentro de la misma transacción (consume_reward ya lo hace en parte) y limitar promoDiscount al valor real del código.

_Hallazgos relacionados que se fusionaron aquí:_ El snapshot financiero (precios, crédito, descuentos, invitados) lo construye el cliente y el servidor lo materializa tal cual; create_order confía en el monto y el snapshot financiero enviados por el cliente; create_order confía en importe, snapshot financiero y TTL enviados por el cliente

### 6. Tablas games, rating y credit_transactions sin RLS y con GRANT ALL a anon
- **Categoría:** seguridad
- **Ubicación:** `full.sql:249`

**Evidencia:** full.sql crea public.games (l.249), public.rating (l.281) y public.credit_transactions (l.206) sin `ENABLE ROW LEVEL SECURITY` y concede `GRANT ALL ON TABLE public.games TO anon` (l.839), rating (l.851), credit_transactions (l.821). Las migraciones solo activan RLS en venues y fields; fields_enable_rls.sql declara explícitamente 'NO se tocan ... games'. El cliente escribe games directamente: src/services/deleteAccountService.js:88 `supabase.from('games').update({ host_user_id: newHost })`.

**Impacto:** Cualquiera que tenga la anon key pública (está en el bundle) puede, sin iniciar sesión, usar PostgREST para hacer UPDATE, DELETE o INSERT sobre cualquier fila de public.games. Puede cambiar price_per_person/price_total, status ('published'/'reserved'/'canceled'), booked_by_user_id, host_user_id o fechas, borrar partidos y crear partidos falsos. Con eso se rompe la integridad de toda la operación de reservas y se pueden manipular los precios que lee la app. Borrar un game arrastra en cascada sus game_players (FK ON DELETE CASCADE, l.482) y deja huérfanas las reservas pagadas. En rating, cualquiera puede leer, falsificar o borrar valoraciones. En credit_transactions, cualquiera puede leer los movimientos de crédito de todos los usuarios (user_id, amount, reason), que es una fuga de datos financieros, y además insertarlos o alterarlos. El hallazgo original dice que se pueden fabricar reembolsos; no es así, porque cancel_rental calcula el reembolso a partir del spend en reservations.

**Fix propuesto:** 1) Antes de cerrar las tablas, migrar las escrituras que hoy hace el cliente sobre games a RPCs SECURITY DEFINER que validen auth.uid() y el rol. La reasignación de host en deleteAccountService.js:88 debe hacerse dentro de un RPC delete_account. El cambio de status en reservationService.js:228 (setMatchReserved) debe ir dentro del RPC de reserva o en un trigger. 2) Después, aplicar una migración con: `alter table public.games enable row level security; create policy games_select_all on public.games for select to anon, authenticated using (true); revoke insert, update, delete, truncate on public.games from anon, authenticated;` 3) Para rating: `alter table public.rating enable row level security;` con una policy SELECT (pública o solo para authenticated) y una policy INSERT `with check (user_id = auth.uid())`, más la condición de que el usuario esté en game_players de ese partido. Revocar update/delete/truncate a anon. 4) Para credit_transactions: `alter table public.credit_transactions enable row level security; create policy ct_select_own on public.credit_transactions for select to authenticated using (user_id = auth.uid()); revoke all on public.credit_transactions from anon; revoke insert, update, delete, truncate on public.credit_transactions from authenticated;` Si la tabla es legado y no se usa (no aparece en src/), se puede eliminar. 5) Comprobar con la anon key que `PATCH /rest/v1/games` y `DELETE /rest/v1/games` devuelven 401/403 o afectan 0 filas.

### 7. claim_rental_double_out_aware permite reservar un alquiler sin pagar (RPC expuesta a authenticated)
- **Categoría:** seguridad
- **Ubicación:** `migrations/claim_rental_double_out_aware.sql:36`

**Evidencia:** L36: `v_actor uuid := coalesce(auth.uid(), p_actor);` L79-82: `update public.games set status = 'reserved', booked_by_user_id = v_actor where id = p_game_id and (status = 'published' or ...)` L90: `grant execute on function public.claim_rental_double_out_aware(uuid, uuid) to authenticated, service_role;`. La función no comprueba ninguna Order confirmada, spend ni pago; solo assert_game_reservable.

**Impacto:** Cualquier usuario autenticado puede llamar a `supabase.rpc('claim_rental_double_out_aware', {p_game_id, p_actor})` sobre cualquier alquiler 'published' que aún no haya empezado. Queda como booker (status='reserved') sin haber creado ni pagado ninguna Order. En una Doble salida, el trigger del Paso 1 bloquea además la cancha gemela. Con la clave anon pública (sin sesión, auth.uid() NULL), el llamador elige p_actor libremente: puede reservar en masa todas las canchas de alquiler a nombre de usuarios reales. Eso deja el inventario de la plataforma bloqueado (pérdida directa de ingresos para las sedes) y atribuye las reservas a víctimas que no las hicieron, sin dejar rastro del atacante real.

**Fix propuesto:** 1) Revocar permisos y dejar solo el backend: `revoke all on function public.claim_rental_double_out_aware(uuid, uuid) from public, anon, authenticated; grant execute ... to service_role;`. 2) Eliminar el fallback de L36: si `auth.role() <> 'service_role'`, usar solo auth.uid() e ignorar p_actor; si es service_role, exigir p_actor. 3) Hacer el claim solo dentro de la materialización del lado del servidor (confirm_order/RPC de servidor). Esa RPC debe bloquear con FOR UPDATE la Order en `status='pending'` (o 'paid') con `payer_id = v_actor` y `resource_id = p_game_id`, y en la misma transacción hacer el claim y el CAS de la Order a 'confirmed'. Para el pago en efectivo, crear una Order 'pending_cash' con expiración (HOLD) en lugar de un claim directo. 4) Corregir de forma general el default privilege de full.sql:904 (`alter default privileges ... revoke execute on functions from anon, public`). Después, auditar el resto de RPC SECURITY DEFINER con parámetros p_actor (por ejemplo reserve_slots, que el cliente llama con p_actor en src/screens/ConfirmReservation.jsx:1131).

### 8. cancel_match reembolsa game_players.amount, columna escrita y editable por el cliente
- **Categoría:** seguridad
- **Ubicación:** `migrations/cancel_match_invited_refund_zero.sql:186`

**Evidencia:** L185-194: `for v_pay in select cp.payer_id, sum(cp.amount) as total from _cancelled_players cp where cp.reservation_type = 'normal' and cp.amount > 0 group by cp.payer_id ... loop perform public.apply_wallet_refund(v_pay.payer_id, v_pay.total);`. El amount viene de game_players, que createGamePlayer upserta desde el navegador (reservationService.js:340-360, `amount: amount`). full.sql:557 `game_players_update_own_or_invited FOR UPDATE USING (user_id = auth.uid() OR invited_by = auth.uid())` no restringe columnas.

**Impacto:** Cualquier usuario autenticado puede generarse saldo en la wallet sin pagar. Basta con insertar (o actualizar, por la política UPDATE sin WITH CHECK) su fila de game_players con un amount alto y estado 'confirmed', y luego autocancelarla con cancel_guest_players/cancelGuestPlayers fuera de la ventana de 24 h: el JS reembolsa ese amount a su wallet. El mismo valor inflado se reembolsa de forma masiva cuando un admin cancela el partido con cancel_match (BLOQUE 8, L185-194).

Además, la fila insertada da un cupo 'confirmed' gratis en el partido. El resultado es pérdida económica directa (crédito usable para reservar canchas) y un ledger de refunds falseado.

**Fix propuesto:** 1) Cerrar la escritura directa:
- REVOKE INSERT, UPDATE, DELETE ON public.game_players FROM anon, authenticated.
- Eliminar las políticas game_players_insert_own_or_invited y game_players_update_own_or_invited.
- Mover el alta de jugadores a una RPC SECURITY DEFINER (o a confirm_order), que fije amount desde el order confirmado o desde games.price_per_person y que fije payer_id = auth.uid().
- Si temporalmente hace falta mantener el UPDATE, añadir un trigger BEFORE UPDATE que lance un error cuando cambien amount, payer_id, status, reservation_type o reservation_id, salvo para service_role o un owner SECURITY DEFINER.

2) Calcular los reembolsos de cancel_match (BLOQUE 7a/8) y de cancel_guest_players desde el ledger del servidor: la reservations 'spend' u el order 'confirmed' vinculado por reservation_id/order_id, limitado a lo realmente cobrado. Nunca desde game_players.amount.

3) Mover el ledger y el applyRefund de cancelGuestPlayers (reservationService.js:607-623) dentro de la RPC, para que el cliente no pueda fijar el monto, y revocar EXECUTE de apply_wallet_refund a authenticated si hoy está concedido.

### 9. createGamePlayer hace upsert directo en game_players con status 'confirmed' y amount elegido por el cliente
- **Categoría:** seguridad
- **Ubicación:** `src/services/reservationService.js:342`

**Evidencia:** await db.from('game_players').upsert({ game_id, user_id: resolvedUserId, payer_id: resolvedPayerId, reservation_id, amount: amount, status: 'confirmed', canceled_at: null, ... }, { onConflict: 'game_id,user_id,payer_id' }) — exportada y usada con db = supabase del navegador (ConfirmReservation.jsx:1075 y vía materializeReservation en ConfirmReservation.jsx:1270). La política game_players_insert_own_or_invited (full.sql:547) solo exige user_id = auth.uid().

**Impacto:** 1) Cualquier usuario autenticado puede ocupar plaza 'confirmed' en cualquier partido sin pagar. Basta llamar a createGamePlayer({gameId}), o hacer un insert/upsert directo por PostgREST, y no queda ni reserva ni cargo, lo que roba capacidad y descuadra la caja.

2) Fraude de saldo: el usuario inserta o actualiza su fila con amount = 5000 (la política UPDATE no tiene WITH CHECK) y luego cancela con más de 24 h. cancelGamePlayer (línea 457) toma ese amount y lo acredita con apply_wallet_refund. Es saldo creado de la nada, repetible en distintos partidos y canjeable en reservas reales.

3) Con canceled_at: null y status 'confirmed', puede reactivar una plaza cancelada (incluso ya reembolsada) sin volver a pagar, y luego cancelarla otra vez para cobrar otro reembolso.

Todo es explotable ahora desde la consola del navegador con la anon key pública.

**Fix propuesto:** 1) Quitar la escritura directa de game_players al cliente. REVOKE INSERT, UPDATE, DELETE ON public.game_players FROM anon, authenticated, y eliminar las políticas game_players_insert_own_or_invited y game_players_update_own_or_invited, dejando solo el SELECT.

2) Mover la materialización a una RPC SECURITY DEFINER (por ejemplo enroll_game_player(p_game_id, p_reservation_id, p_guest_ids[])) o a confirm_order con service-role. Esa RPC debe:
- comprobar auth.uid();
- tomar FOR UPDATE sobre games;
- verificar que existe una reservations 'spend' (u Order confirmada) del actor, propia y aún no consumida para ese game_id;
- calcular amount en el servidor a partir de reservations.unit_price/total o games.price_per_person, nunca del parámetro;
- validar la capacidad;
- no reactivar una fila 'canceled' que ya tenga reembolso.

3) Hacer también la cancelación en el servidor con una RPC cancel_game_player que lea amount de la reserva persistida y llame internamente a apply_wallet_refund.

4) REVOKE EXECUTE ON FUNCTION apply_wallet_refund FROM anon, authenticated, para que solo la invoquen otras funciones SECURITY DEFINER.

5) Como defensa adicional, añadir un trigger BEFORE INSERT/UPDATE que rechace cambios en amount, payer_id y reservation_id cuando current_user no sea el owner o service_role.

## Alto

### 10. Confirmación de pago de campeonatos sin verificación de pago (el cliente marca 'confirmed' directamente)
- **Categoría:** seguridad
- **Ubicación:** `migrations/championship_private_spend_financial_parity.sql:32`

**Evidencia:** La última definición de confirm_championship_gateway_payment(uuid) (SECURITY DEFINER, GRANT a authenticated, línea 129-130) solo comprueba owner_user_id = auth.uid(), status 'gateway_hold' y order 'pending'; luego hace `update public.games set status = 'reserved'` (l.95) y `update public.orders set status = 'confirmed'` (l.98) sin validar ningún comprobante, provider_ref ni webhook. Lo mismo ocurre en confirm_championship_registration (migrations/championships_registration_order_id.sql:89, update a 'confirmed' en l.195) y confirm_championship_team_registration (migrations/championships_team_block_active_individual.sql:145, l.266). El frontend los llama directamente: src/services/championshipService.js:47, :355, :377.

**Impacto:** Cualquier usuario autenticado puede llamar por supabase.rpc a confirm_championship_gateway_payment, confirm_championship_registration o confirm_championship_team_registration justo después de crear la order 'pending', sin pagar nada externo. Con eso reserva las canchas del campeonato (games 'published' a 'reserved', con los Match gemelos bloqueados) o se inscribe o crea equipo en un campeonato público de pago. Además se registra un 'spend' con total_amount externo que nunca se cobró y que luego sirve de techo para reembolsos a crédito AlGrass si se cancela. Eso permite generar saldo de crédito a partir de pagos inexistentes, en la medida en que la política de cancelación reembolse a wallet.

Hoy la pasarela es un mock en toda la app. Pero estas funciones evitan el punto de verificación de pago (Edge Function confirm_order), así que seguirán abiertas cuando se conecte un proveedor real (Culqi). Es una puerta trasera de "pago gratis" que se convierte en pérdida de dinero real al salir del modo simulado.

**Fix propuesto:** 1) En una migración nueva, aplicar a las tres funciones: `revoke execute on function public.confirm_championship_gateway_payment(uuid) from public, anon, authenticated; grant execute ... to service_role;`. Hacer lo mismo con confirm_championship_registration(uuid, text) y confirm_championship_team_registration(uuid, text).

2) Como hoy usan auth.uid(), añadir un parámetro p_actor uuid que solo pueda usar service_role, o crear wrappers internos `_confirm_championship_*` que reciban el actor de forma explícita.

3) Enrutar la confirmación por una Edge Function, por ejemplo extendiendo confirm_order o creando confirm_championship_order. Debe identificar al llamador con el JWT y verificar el cargo contra el proveedor (o la firma del webhook): order_id/metadata, monto = financial_snapshot.external_amount, moneda y estado aprobado. Solo entonces invoca el RPC con service_role. Guardar provider_ref en orders, con un UNIQUE para que no se pueda reutilizar el mismo cargo.

4) Permitir la confirmación directa desde el cliente solo cuando financial_snapshot.external_amount = 0 (pago 100 % con crédito o reward). Validarlo dentro de la función (`if coalesce((v_snap->>'external_amount')::numeric, v_order.amount_total) > 0 and current_user <> 'service_role' then raise exception 'PAYMENT_PROOF_REQUIRED'`).

5) Actualizar src/services/championshipService.js (l.46-48, 353-358, 375-380) para que llame a la Edge Function en lugar de supabase.rpc.

### 11. game_players: UPDATE sin WITH CHECK permite mover filas de partido y generar reembolsos repetidos vía trigger
- **Categoría:** seguridad
- **Ubicación:** `full.sql:557`

**Evidencia:** `CREATE POLICY "game_players_update_own_or_invited" ON public.game_players FOR UPDATE USING ((user_id = auth.uid()) OR (invited_by = auth.uid()));` sin WITH CHECK ni restricción de columnas. El trigger `on_guest_canceled AFTER UPDATE` (l.472) ejecuta handle_guest_cancellation (SECURITY DEFINER, l.108) que en cada transición confirmed->canceled de un invitado inserta un 'refund' en wallet_transactions y suma `credit_balance = credit_balance + v_unit_price` en users (l.141-160). Nada impide volver a 'confirmed'.

**Impacto:** Cualquier usuario autenticado puede modificar por PostgREST sus filas de game_players, y las de sus invitados, cambiando cualquier columna menos user_id/invited_by: 1) volver a 'confirmed' una plaza ya cancelada y reembolsada (cancel_match, cancel_guest_players o cancel_rental reembolsan con apply_wallet_refund), con lo que se queda la plaza y el dinero devuelto; 2) cambiar game_id o reservation_id de una fila confirmada para pasarse a otro partido sin pagar ni pasar por create_order. El trigger gate no actúa si OLD.status ya era 'confirmed', así que tampoco controla el aforo; 3) alterar counts_reserved_slot o game_slot_reservation_id y descuadrar los cupos R1. Además, cada transición confirmed->canceled de un invitado dispara on_guest_canceled e inserta un 'refund' en wallet_transactions y suma a users.credit_balance sin idempotencia, lo que ensucia el ledger legacy. Hoy, con unit_price=0 en invitados y wallet_summary como tabla aparte, eso no llega al saldo gastable.

**Fix propuesto:** Crear una migración que haga: `drop policy "game_players_update_own_or_invited" on public.game_players; revoke update, delete on public.game_players from anon, authenticated;`. Todos los cambios de estado deben pasar por las RPC SECURITY DEFINER que ya existen (cancel_match, cancel_guest_players, cancel_rental, create_order/confirm_order). Si algún flujo cliente necesita UPDATE directo, conceder solo la columna necesaria (`grant update (status) on public.game_players to authenticated`) y añadir la policy con `WITH CHECK (status = 'canceled')`, además de un trigger BEFORE UPDATE que rechace cambios en game_id, reservation_id, game_slot_reservation_id, counts_reserved_slot, invited_by y la transición canceled->confirmed cuando current_user no sea postgres/service_role. Eliminar el trigger legacy `on_guest_canceled` y la función handle_guest_cancellation (`drop trigger on_guest_canceled on public.game_players; drop function public.handle_guest_cancellation();`), porque el reembolso ya lo gestionan las RPC con apply_wallet_refund. Si se mantiene, hacerlo idempotente: comprobar que no exista ya un refund para (reservation_id, game_id, jugador). Por último, regenerar full.sql desde producción (`supabase db dump`) y verificar con `select * from pg_policies where tablename='game_players'` que la policy ya no existe.

### 12. Privilegios por defecto conceden EXECUTE/ALL a anon en toda función y tabla nueva
- **Categoría:** seguridad
- **Ubicación:** `full.sql:904`

**Evidencia:** `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;` (l.904) y `... GRANT ALL ON TABLES TO anon;` (l.914). Varias migraciones solo hacen `grant execute ... to authenticated` sin revocar de public/anon: get_slot_reservation_for_user.sql:123, expire_order.sql:52, waitlist_expired.sql:31, mark_order_confirmed.sql:50, reserved_slots_used_maintenance.sql (rebuild_reserved_slots_used sin grant/revoke), y la vista users_public (users_public_view.sql:40-41 cree que anon no tiene acceso).

**Impacto:** Toda función, vista, tabla o secuencia nueva que cree postgres en public queda accesible con la anon key pública salvo que se revoque explícitamente. Esto ya ocurre en v23. Sin iniciar sesión se puede leer users_public (nombre, user_code, ciudad, sexo, edad, posición y rol de capitán de todos los usuarios, con la RLS saltada), lo que permite raspar PII de forma masiva. También se pueden invocar funciones SECURITY DEFINER sin chequeo de auth.uid(): get_slot_reservation_for_user (consultar reservas de cualquier usuario), mark_order_confirmed (pasar a 'confirmed' órdenes pendientes ajenas sin pago), expire_orders, expire_waitlists y rebuild_reserved_slots_used (mutaciones de mantenimiento disparables por cualquiera, también como DoS o carga). Además, cualquier migración futura que olvide el revoke reabre el problema.

**Fix propuesto:** 1) Añadir una migración que cambie los privilegios por defecto: `alter default privileges for role postgres in schema public revoke execute on functions from public, anon;`, `alter default privileges for role postgres in schema public revoke all on tables from anon;` y `... revoke all on sequences from anon;`. 2) Revocar sobre los objetos existentes: `revoke all on function public.get_slot_reservation_for_user(uuid,uuid), public.mark_order_confirmed(uuid), public.expire_orders(), public.expire_waitlists(), public.rebuild_reserved_slots_used(uuid) from public, anon;` y `revoke all on public.users_public from anon;`. 3) Limitar mark_order_confirmed, expire_orders, expire_waitlists y rebuild_reserved_slots_used a service_role, quitando también el grant a authenticated. Para get_slot_reservation_for_user, exigir auth.uid() no nulo. 4) Volver a conceder a anon solo lo que se navega sin login, objeto por objeto (por ejemplo los RPC públicos de championships). 5) Auditar con `select proname, proacl from pg_proc where pronamespace='public'::regnamespace and proacl::text like '%anon=%';` y `select relname, relacl from pg_class where relnamespace='public'::regnamespace and relacl::text like '%anon=%';`.

### 13. Materialización no atómica: doble confirmación provoca doble reserva y doble cobro
- **Categoría:** eficiencia
- **Ubicación:** `supabase/functions/confirm_order/index.ts:63`
- **Detectado por 2 auditores independientes**

**Evidencia:** mark_order_confirmed.sql:30-36 hace el CAS `update public.orders set status='confirmed' ... where id = p_order_id and status = 'pending'` después de materializar. En confirm_order/index.ts:63 solo se lee `order.status === 'confirmed'` sin lock; L141 `await materializeReservation(ctx, snapshot)` (applySpend, insert de reservations, upsert de game_players y claim de rental como llamadas HTTP separadas); L165 `rpc('mark_order_confirmed')`; L166 dice 'reintento idempotente'.

**Impacto:** Si llegan dos llamadas casi a la vez a confirm_order para la misma Order (doble clic, reintento de red o una carrera provocada a propósito por el payer), las dos ven 'pending' y las dos ejecutan materializeReservation. Resultado: dos filas 'spend' en reservations con el mismo order_id y una actualización no atómica de wallet_summary. Eso puede ser un doble débito para el usuario o, por el lost update de applySpend, un solo débito con dos asientos en el ledger. Si luego se cancela, el usuario podría recibir un reembolso doble. En rentals, la segunda llamada aplica applySpend antes de recibir RENTAL_TAKEN y nada revierte ese cobro. Si la materialización tarda más que pending_expires_at, expire_orders puede pasar la Order a 'expired': la reserva queda materializada pero mark_order_confirmed lanza ORDER_NOT_CONFIRMABLE y la Order no queda confirmada.

**Fix propuesto:** Reservar la Order de forma atómica antes de materializar. Crear una RPC claim_order_for_materialization(p_order_id) que ejecute `update orders set status='materializing', updated_at=now() where id=$1 and status='pending' and pending_expires_at>now() returning *`. Si no devuelve fila, responder 409 o alreadyConfirmed. expire_orders debe ignorar el estado 'materializing' (o usar un lease con caducidad). mark_order_confirmed debe aceptar la transición 'materializing'→'confirmed', y añadir otra RPC para volver a 'pending' o 'failed' cuando la materialización falle. A medio plazo, mover applySpend, el INSERT en reservations, claim_rental y el CAS final a una sola función plpgsql transaccional, y cambiar applySpend por un UPDATE atómico (`credit_balance = credit_balance - x where credit_balance >= x`). Como red de seguridad, añadir `create unique index on reservations(order_id) where order_id is not null and status='spend'` (esto supone revisar la decisión documentada en reservations_order_id.sql:12-13).

_Hallazgos relacionados que se fusionaron aquí:_ Idempotencia solo por status: confirmaciones concurrentes materializan dos veces y doble gasto de crédito

### 14. reserve_slots acepta p_actor de un llamador anónimo (suplantación de capitán)
- **Categoría:** seguridad
- **Ubicación:** `migrations/reserve_slots_hold_aware.sql:32`

**Evidencia:** L32: `v_actor uuid := coalesce(auth.uid(), p_actor);` L308: `grant execute on function public.reserve_slots(uuid, integer, uuid) to authenticated;` sin `revoke ... from public, anon`. full.sql:904 `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS TO "anon"`.

**Impacto:** Cualquiera con la anon key pública, sin iniciar sesión, puede actuar en nombre de cualquier capitán, dueño de cancha o admin inscrito en un partido. Los UUID se sacan de game_players, que se puede leer públicamente (full.sql:553). Hay dos ataques posibles. Primero, llamar con p_reserved_slots_total=0 para liberar o desactivar la R1 de un capitán ('manual_cancel'), lo que le quita los cupos que tenía retenidos para sus invitados. Segundo, subirla hasta el máximo de capacidad pública disponible para que el partido quede lleno (GAME_FULL) y nadie pueda comprar. Es un bloqueo de ventas sin coste y se puede automatizar contra todos los partidos. Además, puede reasignar invitados directos a la R1 (bloque de adopción, L290-300).

**Fix propuesto:** En una nueva migración: `revoke all on function public.reserve_slots(uuid, integer, uuid) from public, anon;` y mantener `grant execute ... to authenticated, service_role;`. Dentro de la función, aceptar p_actor solo desde el backend: `v_actor := case when auth.role() = 'service_role' then coalesce(p_actor, auth.uid()) else auth.uid() end;` y además lanzar una excepción si `p_actor is not null and p_actor <> auth.uid()` cuando el llamador no es service_role. Aplicar el mismo cambio a claim_rental_double_out_aware, que el cliente también llama con p_actor (src/services/reservationService.js:292). Revisar todas las funciones con `coalesce(auth.uid(), p_actor)` y considerar revocar de forma general `ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS FROM anon, public`, concediendo después EXECUTE de forma explícita solo a las RPC que de verdad son públicas.

### 15. Confirmación de pago externo con comprobante 'simulado' falsificable: cualquier usuario obtiene reservas sin pagar
- **Categoría:** seguridad
- **Ubicación:** `supabase/functions/confirm_order/index.ts:30`
- **Detectado por 2 auditores independientes**

**Evidencia:** function isValidSimulatedProof(p) { return !!p && typeof p === 'object' && p.provider === 'simulated' && typeof p.reference === 'string'; } — usado en L117-118 como única validación del modo pasarela; no hay verificación contra gateway ni firma de webhook.

**Impacto:** Cualquier usuario autenticado puede crear una Order propia con payment_provider distinto de 'credit' (por ejemplo 'gateway') e invocar confirm_order con {orderId, paymentProof:{provider:'simulated', reference:'x'}}. Con eso materializa la reserva (cupos de partido, invitados, alquiler de cancha, inscripciones a campeonatos) y la Order queda en CONFIRMED sin ningún cobro, con una tasa de éxito del 100% (no depende del 80% aleatorio del cliente). El resultado son reservas y cupos tomados sin pagar, pérdida de ingresos para sedes y organizadores, y bloqueo de capacidad para otros usuarios. Mientras el seam siga en modo simulado, cualquier despliegue con precios reales queda expuesto a fraude económico directo.

**Fix propuesto:** 1) Ahora mismo: cerrar el modo simulado con una variable de entorno de la Edge Function, por ejemplo ALLOW_SIMULATED_PAYMENTS, que por defecto sea false. En producción, si no es 'true', la rama de pasarela (L116-118) debe devolver 403 PAYMENT_GATEWAY_DISABLED. 2) Al integrar Culqi: que confirm_order no confíe en el paymentProof del cliente. Debe recibir solo el charge_id o token y consultar el cargo server-side en la API de Culqi con la clave secreta, exigiendo estado pagado/capturado, monto igual a orders.amount_total (en céntimos), moneda igual a orders.currency y metadata.order_id igual a order.id. Mejor aún, confirmar solo desde un webhook cuya firma HMAC se verifique. 3) Persistir provider_charge_id en orders con un índice UNIQUE para que un mismo cargo no confirme varias Orders. 4) Validar en create_order que payment_provider pertenezca a una lista cerrada ('credit', 'gateway') y recalcular amount_total server-side en lugar de aceptarlo del cliente.

_Hallazgos relacionados que se fusionaron aquí:_ Pago aprobado en el navegador y comprobante falsificable

### 16. Autorización de invitación gratuita evaluada sobre order.resource_id pero materializada sobre snapshot.gameId
- **Categoría:** seguridad
- **Ubicación:** `supabase/functions/confirm_order/index.ts:90`

**Evidencia:** L90-93: .from('games').select('host_user_id').eq('id', order.resource_id) → isHost; luego L141 materializeReservation usa snapshot.gameId (src/services/materializeReservation.js L27-28) sin comprobar que coincidan; invited=true omite applySpend (src/services/reservationService.js L318).

**Impacto:** El host de cualquier partido A, o un usuario que haya creado uno, puede llamar a create_order con p_resource_id=A y un p_financial_snapshot={invited:true, gameId:B, gameType:'match', importes 0}. Después llama a confirm_order: pasa la autorización como host de A, pero la reserva ('invited', sin cargo ni movimiento de wallet) y la fila de game_players se crean en el partido B de otro organizador. Así ocupa plazas de pago gratis, y el organizador de B pierde esos ingresos. Además, sobre B no se ejecutan assert_game_reservable, el control de holds pendientes ni public_availability, porque create_order solo los evaluó sobre A. Por eso podría entrar en partidos cerrados o no reservables, aunque el trigger de capacidad de game_players sigue aplicando. El mismo desacople permite, en los caminos de crédito y pasarela, validar o pagar contra A y materializar en B.

**Fix propuesto:** En confirm_order, antes del paso 4 (L86), rechazar la orden si el snapshot no coincide con ella: if (order.financial_snapshot?.gameId !== order.resource_id || (order.financial_snapshot?.gameType ?? 'match') !== order.resource_type) return json({ error: 'SNAPSHOT_MISMATCH' }, 400). Además, construir el snapshot forzando el recurso desde la Order: const snapshot = { ...order.financial_snapshot, gameId: order.resource_id, gameType: order.resource_type, source }. Como defensa en profundidad, en public.create_order añadir: if (p_financial_snapshot->>'gameId')::uuid is distinct from p_resource_id then raise exception 'SNAPSHOT_RESOURCE_MISMATCH'. Así ninguna Order puede guardar un snapshot que apunte a otro recurso. También conviene que el servidor derive hostUserId desde games y no desde el snapshot.

### 17. Materialización no atómica: escrituras parciales sin rollback (débito antes de insertar la reserva)
- **Categoría:** eficiencia
- **Ubicación:** `src/services/reservationService.js:318`

**Evidencia:** if (!invited) { await applySpend(actor, spendArgs, ctx); } const { data, error } = await db.from('reservations').insert(reservationRow)... — múltiples round-trips independientes desde la Edge Function (applySpend: ensureWalletSummary + select + upsert; insert reservation; rpc claim_rental; createGamePlayer por invitado; reserve_slots).

**Impacto:** El escenario concreto es este. Una carrera con el camino interno sin HOLD, que está documentada en index.ts L144-151, hace que el `createGamePlayer` del titular falle con GAME_FULL, o que falle `reserve_slots`. Para entonces `applySpend` ya restó el crédito del usuario (wallet_summary.credit_balance) y la fila `spend` ya está en reservations. La Order queda PENDING y no hay rollback ni reembolso. El cliente puede incluso mostrar que no hubo cobro ("sin cobro") o un error recuperable. Si el usuario o la red reintentan confirm_order mientras la Order sigue pending, se debita otra vez y se duplica el asiento del ledger.

Además:
- `applySpend` es read-modify-write sin bloqueo. Dos confirmaciones concurrentes del mismo usuario pueden pisarse y dejar saldos incorrectos, o permitir gastar más crédito del disponible porque el chequeo de saldo de index.ts L113 no es atómico.
- Los fallos de invitados quedan en silencio: se devuelve `ok:true` aunque el roster esté incompleto.
- Cada confirmación hace entre 6 y 10 round-trips HTTP, lo que alarga la ventana de carrera y la latencia. Esto importa porque la Order de crédito tiene un TTL de solo 15 s.

**Fix propuesto:** 1. Mover toda la materialización a una única función PL/pgSQL `materialize_order(p_order_id uuid)` SECURITY DEFINER, con search_path fijado y EXECUTE revocado a anon/authenticated, que se ejecute en una sola transacción. La función debe:
   - hacer `SELECT ... FROM orders WHERE id = p_order_id AND status = 'pending' FOR UPDATE` como guarda de idempotencia;
   - hacer `SELECT ... FROM wallet_summary WHERE user_id = ... FOR UPDATE` y validar el saldo dentro de la transacción (`IF credit_balance < v_credit THEN RAISE EXCEPTION 'INSUFFICIENT_CREDIT'`);
   - aplicar el débito con `UPDATE wallet_summary SET credit_balance = credit_balance - v_credit, total_amount = total_amount + v_total ...`, que es atómico;
   - insertar en reservations con `order_id`, con un índice UNIQUE parcial sobre `reservations(order_id) WHERE order_id IS NOT NULL` para impedir asientos duplicados;
   - hacer el claim del rental, el insert/upsert en game_players del titular y de los invitados, y `reserve_slots`;
   - cambiar `orders.status` a 'confirmed' al final.
   Cualquier RAISE (GAME_FULL, RENTAL_TAKEN o un error inesperado) revierte todo.
2. La Edge Function pasa a hacer un solo `admin.rpc('materialize_order', { p_order_id })` y mapea el SQLSTATE o el mensaje de error.
3. Mientras eso se implementa:
   - (a) añadir el índice UNIQUE sobre reservations.order_id;
   - (b) propagar los errores de los `createGamePlayer` de invitados y del titular cuando no son GAME_FULL;
   - (c) añadir compensación explícita (reembolso de wallet y borrado de la reserva) en las ramas GAME_FULL/RENTAL_TAKEN;
   - (d) corregir el supuesto de atomicidad en ConfirmReservation.jsx L973-974.

### 18. Validación y cálculo del descuento de código promocional solo en el cliente
- **Categoría:** seguridad
- **Ubicación:** `src/services/reservationService.js:179`

**Evidencia:** const discount = data.discount_type === 'fixed' ? Math.min(Number(data.discount_amount) || 0, unitPrice) : Math.min(unitPrice * (data.discount_percent / 100), unitPrice); — luego createReservation inserta promo_code_id/promo_discount recibidos (líneas 267-269) sin revalidar límites (max_uses_total/max_uses_per_user, ciudad, tipo, vigencia).

**Impacto:** Un usuario autenticado puede mandar promoDiscount con cualquier valor (incluso igual al unitPrice) y cualquier promoCodeId, o ninguno. Para eso le basta llamar directamente a create_order o hacer insert en reservations con la anon key. Así se salta la vigencia, la ciudad, el tipo de partido y los límites max_uses_total / max_uses_per_user. Esos límites dependen de un COUNT que se hace antes y que no es atómico: con dos reservas simultáneas se puede gastar el último uso más de una vez. Como el cliente también fija totalAmount y subtotalAmount, el ledger de reservations y wallet_summary guardan montos que el usuario eligió. Eso afecta la contabilidad y los reembolsos futuros (refunds y crédito) que se calculen sobre esos montos. Hoy el cobro es simulado. Cuando se conecte la pasarela real, esto será una pérdida de dinero directa.

**Fix propuesto:** 1) Crear una función SQL SECURITY DEFINER, por ejemplo apply_promo(p_code text, p_game_id uuid, p_user uuid) RETURNS (promo_id, discount). Debe hacer SELECT ... FROM promo_codes WHERE upper(code)=upper(p_code) FOR UPDATE, revisar starts_at/expires_at con now() en America/Lima, revisar promo_games_type contra games.type y city contra la ciudad del venue, contar los usos 'spend' (globales y por usuario) dentro de la misma transacción, y calcular el descuento a partir de games.price leído en el servidor. 2) Llamarla desde create_order y confirm_order, y desde la ruta interna (crédito/0) mediante una RPC. Esas funciones deben recalcular unit_price, promo_discount y total a partir de la BD, y descartar los valores del financial_snapshot del cliente (o rechazar la operación si no coinciden). 3) Quitar el INSERT directo sobre reservations a authenticated/anon: hacer REVOKE INSERT y borrar las políticas reservations_insert_own y "users can insert own reservations", para que las reservas solo se creen con RPC. Como alternativa, agregar un trigger BEFORE INSERT que recalcule promo_discount y total_amount. 4) Dejar validatePromoCode en el cliente solo como vista previa en la UI.

### 19. Cancelación de partido orquestada en el cliente: no atómica y sin compensación ante fallos
- **Categoría:** seguridad
- **Ubicación:** `src/services/reservationService.js:443`

**Evidencia:** Secuencia en el navegador: rpc match_cancellation_window (429) → update game_players status 'canceled' (443-448) → insert ledger 'refund' (465, error solo se loguea) → applyRefund (477, sin comprobar error) → setMatchPublishedIfEmpty → notifyWaitlistUsers.

**Impacto:** 1) Falta de atomicidad: si se cierra la pestaña o falla la red después del update (443-448), la plaza queda cancelada sin fila de ledger ni crédito en la billetera. Los fallos del ledger (476) y de apply_wallet_refund (39) se ignoran en silencio, así que puede haber crédito sin ledger o ledger sin crédito, y nadie lo detecta. 2) Manipulación del importe: el reembolso se calcula en el cliente a partir de game_players.amount, columna que el propio jugador puede editar por RLS (full.sql:557, sin WITH CHECK). Un usuario puede subir amount en su plaza confirmada y, al cancelar dentro del plazo con derecho a reembolso, recibir un crédito inflado en la billetera, es decir, dinero ficticio que luego puede gastar en reservas. 3) Los efectos secundarios (republicar el partido y avisar a la lista de espera, 460-461) se ejecutan antes de que el reembolso esté asegurado.

**Fix propuesto:** Crear la RPC public.cancel_match_self(p_game_id uuid) como SECURITY DEFINER, con search_path = public y una sola transacción, siguiendo el patrón de cancel_rental. Debe hacer lo siguiente: comprobar auth.uid(); bloquear la fila del jugador con SELECT ... FOR UPDATE donde user_id = auth.uid() y status = 'confirmed'; calcular la ventana de 24 h dentro de la misma función, reutilizando la lógica de match_cancellation_window; tomar el importe del registro económico del servidor (reservations.unit_price del pedido u orders), no de game_players.amount; actualizar a 'canceled'; insertar el ledger 'refund'; llamar a apply_wallet_refund(payer_id, importe); republicar el partido si queda vacío; y devolver jsonb { refund_amount, had_credit }. Cualquier error debe lanzar RAISE para que se revierta todo. En el cliente, cancelGamePlayer solo llamaría a esta RPC y enviaría la notificación con el resultado. Además: (a) aplicar REVOKE EXECUTE ON FUNCTION apply_wallet_refund(uuid, numeric) FROM anon, authenticated, para que solo se pueda invocar desde otras funciones SECURITY DEFINER; (b) restringir la política UPDATE de game_players con un WITH CHECK o un trigger BEFORE UPDATE que impida que el cliente cambie amount, payer_id o reservation_id (o retirar el UPDATE directo y canalizarlo por RPC).

### 20. La clave de acceso de campeonatos privados solo se aplica en la interfaz: el roster y la competición se descargan antes de validar la clave
- **Categoría:** seguridad
- **Ubicación:** `src/screens/ChampionshipView.jsx:377`

**Evidencia:** loadRegState(): `const canLoad = st === 'registration_open' || st === 'registration_closed' || st === 'in_progress' || st === 'completed' || ...` no considera needsKey/gateOpen/verifiedGrant (línea 407 define needsKey pero no se usa para el fetch). getChampionshipRegistrationState (l.384) y getChampionshipCompetition (l.950) se llaman siempre. migrations/championships_phase30_public_read_anon.sql:13 confirma que 'privacy/registration_key nunca fueron gate de estas lecturas: era una cortina de FRONTEND' y concede EXECUTE a anon. Además verifiedGrant se siembra desde sessionStorage editable (l.317 `cachedReal?.accessOk === true`, persistido en l.1146).

**Impacto:** Cualquier visitante, incluso anónimo con la anon key pública, puede leer el roster completo de un campeonato privado sin conocer la clave. Eso incluye equipos, nombres y avatares de jugadores y organizadores. Funciona en registration_open, registration_closed, in_progress y completed. En los mismos estados puede leer también la competición: partidos, goles y tablas. Basta llamar por REST a /rpc/get_championship_registration_state o /rpc/get_championship_competition con el ID, que aparece en el listado público junto a privacy='private'. La propia app también descarga esos datos antes de validar la clave, así que se ven en la pestaña de red. Además, el gate de la UI se salta poniendo accessOk:true en la caché CV de sessionStorage. La clave de acceso de los privados no protege ninguna lectura.

**Fix propuesto:** Servidor (lo principal): en get_championship_registration_state y get_championship_competition, añadir después del gate por status una condición con dos partes. Primera: si v_champ.privacy = 'private' y el actor no es owner, host (host_user_id), miembro inscrito ni AlGrass, se exige un grant de acceso en servidor. Para eso se crea una tabla championship_access_grants(championship_id, user_id, expires_at). La rellena verify_championship_access cuando la clave es correcta (con usuario autenticado), y las RPC de lectura la consultan con auth.uid(). Segunda: para anónimos, aceptar como parámetro un token firmado de corta duración (HMAC con un secreto de servidor) devuelto por verify_championship_access, o directamente denegar y exigir login. Hay que respetar la excepción results_public=true en in_progress/completed si se quiere mantener la lectura pública de resultados. Revisar si conviene revocar EXECUTE a anon (phase30) para los privados. Cliente: condicionar loadRegState y loadCompetition a `!needsKey || verifiedGrant` (y añadirlo a las deps de canLoadRegState y canLoadCompetition). Dejar de sembrar verifiedGrant desde cachedReal.accessOk en la l.317: revalidar siempre con el backend, aunque esto solo mejora la UI y no sustituye el control en servidor.

## Medio

### 21. mark_order_confirmed sin control de propietario y ejecutable por authenticated/anon
- **Categoría:** seguridad
- **Ubicación:** `migrations/mark_order_confirmed.sql:50`
- **Detectado por 3 auditores independientes**

**Evidencia:** Función SECURITY DEFINER que hace `update public.orders set status = 'confirmed' where id = p_order_id and status = 'pending'` (l.30-36) sin auth.uid(); el comentario (l.14-15) indica que solo debe usarla confirm_order con service-role, pero `grant execute ... to authenticated, service_role;` (l.50) y no hay `revoke ... from public, anon` (full.sql:904 concede por defecto ALL ON FUNCTIONS a anon).

**Impacto:** Cualquier usuario autenticado, e incluso anon por los privilegios por defecto de full.sql:904, puede llamar a la RPC /rest/v1/rpc/mark_order_confirmed y pasar a 'confirmed' una order 'pending' cuyo id conozca, sin pago ni materialización. Eso rompe la invariante de que confirm_order es el único que escribe 'confirmed' (Regla 2: CONFIRMED implica materialización). Consecuencias:
- La order queda 'confirmed' sin reserva ni spend, un registro inconsistente que contamina los informes de órdenes.
- El hold de cupo o alquiler se libera antes de tiempo.
- expire_orders ya no limpia esa order.
- Un campeonato en gateway_hold queda bloqueado para siempre, porque confirm_championship_gateway_payment exige order 'pending' y devuelve INVALID_STATE.
- Con el UUID de una order ajena (por ejemplo, filtrado en logs o URLs) se puede sabotear la compra de otro usuario: su confirm_order devolvería alreadyConfirmed sin haber materializado nada.
No permite obtener reservas ni crédito gratis: el débito y la reserva solo ocurren en materializeReservation.

**Fix propuesto:** Crear una migración nueva que restrinja la ejecución a service_role, que es el único llamador legítimo (la Edge Function confirm_order):
```sql
revoke all on function public.mark_order_confirmed(uuid) from public, anon, authenticated;
grant execute on function public.mark_order_confirmed(uuid) to service_role;
```
Como defensa en profundidad, añadir al inicio del cuerpo `if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;`. Revisar también fail_order y expire_orders por si tienen el mismo patrón, y aplicar en general `alter default privileges ... revoke execute on functions from anon, public` para que las funciones nuevas no queden expuestas por defecto.

_Hallazgos relacionados que se fusionaron aquí:_ mark_order_confirmed concedida a authenticated sin validar el payer; mark_order_confirmed ejecutable por cualquier usuario autenticado y sin verificación de payer

### 22. get_slot_reservation_for_user (IDOR) y parámetro 'referral' de create_order permiten consumir cupos reservados ajenos
- **Categoría:** seguridad
- **Ubicación:** `migrations/get_slot_reservation_for_user.sql:40`

**Evidencia:** `v_actor uuid := p_user_id;` (l.40): SECURITY DEFINER que devuelve la reserva de cualquier usuario indicado por parámetro, sin comprobar auth.uid(); grant a authenticated (l.123) y anon por defecto. create_order toma `v_referral := nullif(p_financial_snapshot->>'referral','')::uuid` del cliente (rollback_pre_championship_gateway_guards.sql:128) y suma su effective_reserved_slots_remaining a la capacidad (l.130-142).

**Impacto:** Cualquier usuario autenticado, y probablemente también anon por el EXECUTE por defecto, puede consultar las SlotReservations de cualquier capitán en cualquier partido: id, estado, total, usados, restantes y el grupo al que pertenece. Si pone el UUID del capitán como 'referral' en p_financial_snapshot (o en ?ref=), create_order suma los cupos reservados de ese capitán a la capacidad. Así el atacante supera NO_CAPACITY aunque el partido esté lleno, y el cliente lo inscribe en el grupo del capitán con counts_reserved_slot=true. El resultado es que ocupa los cupos que el capitán reservó para su grupo, y sus jugadores legítimos se quedan fuera (denegación de servicio sobre la reserva). Además queda registrado referred_by_user_id=capitán sin que el capitán lo haya invitado, lo que puede distorsionar las recompensas por referido. No expone PII ni pagos.

**Fix propuesto:** 1) En get_slot_reservation_for_user: añadir `revoke execute on function public.get_slot_reservation_for_user(uuid, uuid) from public, anon;` y exigir `auth.uid() is not null`. Mejor aún, que el cliente no la llame: que el servidor calcule la asignación de grupo y devuelva solo un booleano o el número de cupos disponibles del link, sin ids ni contadores de terceros.

2) En create_order (migrations/rollback_pre_championship_gateway_guards.sql:127-131) dejar de aceptar un UUID arbitrario como referral. Crear un token de invitación opaco (por ejemplo, una tabla game_share_links con token aleatorio, game_id, owner_user_id, expires_at y max_uses), que el capitán genera para cada partido. create_order resolvería el referral a partir de ese token y lo validaría: que no esté vencido, que corresponda a p_resource_id y que la reserva del dueño siga activa. Así solo cuentan los cupos del capitán cuando se usa un link emitido por él.

3) Mover al servidor la asignación de game_slot_reservation_id y referred_by_user_id, que hoy hacen resolveCaptainGroupAssignment y createGamePlayer en el cliente. Debe usar el mismo referral ya validado, para que el cliente no pueda forzar la pertenencia a un grupo ajeno.

### 23. Clave de equipo en texto plano, mínimo 4 caracteres y sin límite de intentos
- **Categoría:** seguridad
- **Ubicación:** `migrations/championships_team_join_secret_plaintext.sql:39`
- **Detectado por 2 auditores independientes**

**Evidencia:** `alter table public.championship_teams add column if not exists join_secret text;` (l.39) reemplaza el hash bcrypt; se guarda también en orders.claim_composition (l.117-118). Longitud mínima 4 (l.91, l.340). join_championship_team_with_secret compara `if v_in <> v_key then raise exception 'INVALID_SECRET'` (l.297; versión vigente en championships_free_join_registration_closed.sql:66) sin contador de intentos ni bloqueo.

**Impacto:** Un usuario autenticado que conozca el teamId (va en el enlace compartido ?team=) puede probar claves sin límite contra join_championship_team_with_secret. Con claves de solo 4 caracteres elegidas por personas, puede adivinarlas y unirse gratis al roster de un equipo ajeno que pagó la inscripción. Cada intento toma el advisory lock del campeonato: un ataque en masa degrada la inscripción y las uniones legítimas de ese campeonato. Las claves se guardan en claro en championship_teams.join_secret y en orders.claim_composition. Una fuga de la BD, de un backup, de un export o del service role las expone todas. RLS y los revoke impiden leerlas desde la API del cliente.

**Fix propuesto:** 1) Límite de intentos: crear la tabla championship_team_join_attempts(team_id, user_id, ts, ok). En join_championship_team_with_secret, antes de comparar la clave, rechazar con TOO_MANY_ATTEMPTS si hay 5 o más fallos de (team_id, user_id) en los últimos 10 minutos, más un tope global por team_id. Registrar cada fallo. El chequeo debe ir antes del pg_advisory_xact_lock del campeonato, o el lock debe tomarse solo tras validar la clave, para que la fuerza bruta no serialice el campeonato. 2) Subir el mínimo a 8 caracteres en create_championship_team_registration_order (l.91) y en update_championship_team_secret (l.340), o generar la clave en el servidor con gen_random_bytes. 3) No copiar la clave a orders.claim_composition (l.118). Pasarla por una tabla temporal o guardar solo crypt(v_secret, gen_salt('bf')) y moverla al confirmar. 4) Valorar volver a join_secret_hash (bcrypt) y mostrar la clave solo al crearla o rotarla. Si el producto exige que el owner pueda verla después, cifrarla con pgsodium/Vault en vez de guardarla en texto plano.

_Hallazgos relacionados que se fusionaron aquí:_ Clave de equipo de campeonato recuperable en texto plano

### 24. Vista DEFINER users_public expone sexo/edad aunque profile_private y es accesible por anon
- **Categoría:** seguridad
- **Ubicación:** `migrations/users_public_view.sql:17`

**Evidencia:** La vista (sin security_invoker, l.2) devuelve `sex` (l.17) y `EXTRACT(YEAR FROM age(birth_date))` (l.18) para todos, junto a `profile_private` (l.19); el comentario l.3 indica que la privacidad solo se aplica en el frontend. El GRANT a anon está comentado (l.41) pero full.sql:914 concede ALL ON TABLES a anon por defecto.

**Impacto:** Cualquier usuario autenticado, y casi seguro también un cliente anónimo que use solo la anon key pública (por los privilegios por defecto de full.sql:914), puede consultar GET /rest/v1/users_public?select=id,full_name,sex,age,city,profile_private y obtener en bloque el sexo y la edad de todos los usuarios activos. Esto incluye a quienes activaron 'perfil privado' en Settings. La opción de privacidad no protege nada en el servidor y permite armar un listado nombre+ciudad+sexo+edad. Nota: mientras siga activa la policy users_select_public USING(true) (full.sql:586), la tabla public.users expone todavía más datos (birth_date, phone, etc.), y eso conviene corregirlo junto con esto.

**Fix propuesto:** Aplicar la privacidad en SQL dentro de la vista, por ejemplo: `CASE WHEN profile_private AND id <> auth.uid() THEN NULL ELSE sex END AS sex, CASE WHEN profile_private AND id <> auth.uid() THEN NULL ELSE EXTRACT(YEAR FROM age(birth_date))::int END AS age`. Añadir explícitamente `REVOKE ALL ON public.users_public FROM anon;` (y `REVOKE INSERT, UPDATE, DELETE ... FROM authenticated`, dejando solo SELECT), porque los privilegios por defecto de full.sql:913-916 conceden ALL. En la misma migración, eliminar la policy `users_select_public` sobre public.users (full.sql:586) y reemplazarla por una de solo lectura propia (`USING (id = auth.uid())`), para que users_public sea de verdad la única superficie pública. Después ajustar GameDetail.jsx para que trate sex/age NULL como ocultos.

### 25. reservations sin índices en game_id/user_id/status usados por RLS y cancelaciones
- **Categoría:** eficiencia
- **Ubicación:** `full.sql:423`, `full.sql:294`
- **Detectado por 2 auditores independientes**

**Evidencia:** Solo existe `reservations_pkey` (l.423); las migraciones añaden índices por championship_id, order_id y promo (championships_phase4_admin_validation.sql:31, reservations_order_id.sql:27, promotions_v1.sql:88), pero ninguno por user_id ni (game_id, user_id, status). Consultas calientes: policy `reservations_select_own` USING (user_id = auth.uid()) (full.sql:571), cancel_rental_self `where r.game_id = p_game_id and r.user_id = v_actor and r.status = 'spend' order by r.reserved_at desc` (migrations/rental_cancellation.sql:155-161), handle_guest_cancellation (full.sql:126-130).

**Impacto:** La tabla reservations es un ledger que solo crece (spend/refund/canceled). Cada lectura de "mis reservas" con RLS, cada cancelación (cancel_rental_self) y cada disparo del trigger handle_guest_cancellation hacen un seq scan completo. La latencia crece de forma lineal con el historial, y dentro de las transacciones de cancelación/reembolso se alarga el tiempo que se mantienen los locks. Hoy el impacto es bajo, pero empeora a medida que crece el volumen.

**Fix propuesto:** Crear una migración nueva (fuera de una transacción, porque CONCURRENTLY no la admite): `create index concurrently if not exists reservations_user_reserved_idx on public.reservations (user_id, reserved_at desc);` cubre la RLS por user_id y los listados del perfil ordenados por fecha. `create index concurrently if not exists reservations_game_user_status_idx on public.reservations (game_id, user_id, status, reserved_at desc);` cubre cancel_rental_self (incluido el ORDER BY ... LIMIT 1) y handle_guest_cancellation. Después, validar con EXPLAIN ANALYZE las consultas de Profile.jsx/reservationService.js, y añadir los índices también a full.sql para que el esquema base no se desincronice.

_Hallazgos relacionados que se fusionaron aquí:_ Faltan índices en columnas FK y de filtro de reservations, games y user_roles usadas por RLS y RPCs

### 26. process_referral_rewards recalcula cada 15 minutos una vista con ventana sobre todo el histórico
- **Categoría:** eficiencia
- **Ubicación:** `migrations/rewards_phase3_referral_auto.sql:196`

**Evidencia:** L90-124: la vista player_first_completed_activity hace UNION ALL de game_players JOIN games (todos los completados) y `row_number() over (partition by a.user_id order by date_key, time, game_id)`. L196-213: el loop la consulta sin filtrar por usuario y luego hace join con gp por `referral_reward_evaluated_at is null`; NOT EXISTS sobre games con `(ge.date_key, ge.time, ge.id) < (...)` y `ge.status not in (...)`. L245: cron `'2,17,32,47 * * * *'`.

**Impacto:** Cada 15 minutos (cron '2,17,32,47 * * * *', línea 245), process_referral_rewards recalcula la vista player_first_completed_activity sobre todo el histórico: todas las participaciones confirmadas en matches completados más todos los rentals completados, ordenadas por usuario. Lo hace aunque solo haya unas pocas filas pendientes o ninguna. El costo crece linealmente con el histórico (más el ordenamiento) y no con el trabajo real pendiente. A medida que crezca la base, el job consumirá CPU e I/O de forma constante y competirá con el tráfico de reservas en la misma instancia de Supabase. Sin índice sobre games(type, status, booked_by_user_id) ni sobre game_players(user_id, status), el NOT EXISTS de la guardia de orden (líneas 205-213) también puede degenerar en recorridos secuenciales por cada candidato. No hay riesgo de doble pago, porque el claim atómico y la idempotency_key lo impiden. El impacto es solo de rendimiento.

**Fix propuesto:** Hay que invertir el driver del loop para partir de los pendientes, que sí usan el índice parcial, y calcular la primera actividad solo para esos usuarios con un LATERAL ... LIMIT 1. Ejemplo: `for p in select gp.id as gp_id, gp.user_id as referred_user_id, gp.referred_by_user_id as referrer_id, gp.game_id from public.game_players gp join public.games g on g.id = gp.game_id where gp.referral_reward_evaluated_at is null and gp.referred_by_user_id is not null and gp.status = 'confirmed' and g.type = 'match' and g.status = 'completed' limit 500 loop` y dentro calcular `select x.game_id from (select g2.id as game_id, g2.date_key, g2.time from game_players gp2 join games g2 on g2.id = gp2.game_id where gp2.user_id = p.referred_user_id and gp2.status = 'confirmed' and g2.type = 'match' and g2.status = 'completed' union all select g3.id, g3.date_key, g3.time from games g3 where g3.type = 'rental' and g3.status = 'completed' and g3.booked_by_user_id = p.referred_user_id) x order by x.date_key, x.time, x.game_id limit 1`. Se procesa solo si coincide con p.game_id y referred_by <> user_id; si no coincide, se marca como evaluado sin pagar. La guardia NOT EXISTS se mantiene igual. Así se conserva una única definición de newcomer, que puede extraerse a una función SQL `first_completed_activity(p_user uuid)` reutilizada por la vista. Índices a añadir: `create index on public.game_players (user_id, status)`, `create index on public.games (booked_by_user_id, date_key, time) where type = 'rental'` y opcionalmente `create index on public.games (status) where status not in ('completed','canceled','expired')` para la guardia. Con LIMIT 500 por corrida, el tiempo del job queda acotado.

### 27. Trigger FOR EACH ROW recuenta game_players sin índice en game_slot_reservation_id
- **Categoría:** eficiencia
- **Ubicación:** `migrations/reserved_slots_used_maintenance.sql:28`

**Evidencia:** L28-36: `update public.game_slot_reservations gsr set reserved_slots_used = (select count(*) from public.game_players gp where gp.game_slot_reservation_id = p_game_slot_reservation_id and gp.status='confirmed' and gp.counts_reserved_slot = true) where gsr.id = ...`. L76-78: `after insert or update or delete on public.game_players for each row`. No hay ningún `create index` sobre game_players(game_slot_reservation_id) en migrations/ ni en full.sql (solo game_id/status, game_id/invited_by y user_id). release_slot_reservation.sql:59-62 también filtra por game_slot_reservation_id.

**Impacto:** Cada INSERT o DELETE en game_players, y cada UPDATE de status, counts_reserved_slot o game_slot_reservation_id, hace un recorrido secuencial completo de game_players, una tabla que crece sin límite con el histórico de partidos. Las operaciones que cambian N filas de golpe (cancelar un partido, release_slot_reservation, cancel_guest_players) hacen N recuentos completos, un coste O(N·filas), dentro de transacciones que mantienen bloqueada la fila de games. Eso alarga los bloqueos y la latencia de las RPC a medida que crece el volumen. Hay además un efecto secundario: en READ COMMITTED, dos transacciones simultáneas sobre la misma reserva pueden contar sin ver la inserción de la otra y dejar reserved_slots_used un poco por debajo del valor real hasta el siguiente recálculo. Se mitiga en parte porque reserve_slots bloquea games FOR UPDATE.

**Fix propuesto:** 1) Crear un índice parcial que cubra el COUNT: `create index concurrently if not exists game_players_gsr_confirmed_idx on public.game_players (game_slot_reservation_id) where status = 'confirmed' and counts_reserved_slot = true;`. Con él, el recuento pasa a ser un index-only scan sobre pocas filas. 2) Opcional: convertir el trigger a nivel de sentencia, `FOR EACH STATEMENT` con `REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows`, y llamar a rebuild_reserved_slots_used una sola vez por cada game_slot_reservation_id distinto de la unión de las dos tablas. Así se evitan los N recálculos en las cancelaciones masivas. 3) Para serializar el recálculo, hacer `select 1 from game_slot_reservations where id = p_id for update` antes del COUNT, o confirmar que todas las rutas de escritura ya bloquean games FOR UPDATE.

### 28. reserve_slots descuenta todos los holds pendientes del propio actor, no solo el que se materializa
- **Categoría:** eficiencia
- **Ubicación:** `migrations/reserve_slots_hold_aware.sql:176`

**Evidencia:** L170-176: `select coalesce(sum(o.claimed_units), 0) into v_holds from public.orders o where o.resource_id = p_game_id and o.status = 'pending' and o.pending_expires_at > now() and o.payer_user_id <> v_actor;`

**Impacto:** Si el capitán tiene otra Order pending viva sobre el mismo partido, por ejemplo una pestaña con el pago de la pasarela en curso o un reintento con otra idempotency_key, reserve_slots no descuenta esa capacidad retenida. Desde «Gestionar mi lista» (ConfirmReservation.jsx:1131) o desde la materialización de otra Order, puede crear o ampliar la R1 sobre plazas que ya estaban prometidas a ese hold. Cuando el hold se pague y se materialice, los game_players se insertan sin control de capacidad en servidor y se supera total_spots (sobreventa). Si el cliente detecta GAME_FULL, el usuario queda cobrado sin plaza y hay que reembolsar a mano.

**Fix propuesto:** Excluir solo la Order que se está materializando. Para ello, añadir el parámetro `p_order_id uuid default null` a reserve_slots y cambiar el filtro de L176 por `and o.id is distinct from p_order_id`, con lo que los demás holds del actor siguen contando. Pasar ese id desde materializeReservation.js:84 (el id de la Order pagada). En los flujos sin Order (ConfirmReservation.jsx:1131/1199, GameDetail.jsx:1545) pasar null, para que cuenten todos los holds, incluidos los del propio actor. Otra opción es marcar la Order como no pending antes de llamar a reserve_slots y quitar la exclusión por payer. Como defensa adicional, revalidar la capacidad en servidor al insertar en game_players, con un trigger o un RPC de materialización que compruebe total_spots bajo FOR UPDATE de games.

### 29. Inscripción de terceros y consumo de cupos reservados de otros usuarios a partir de datos del snapshot (guests/referral)
- **Categoría:** seguridad
- **Ubicación:** `src/services/materializeReservation.js:73`

**Evidencia:** await Promise.all(guests.map(guest => { ... return createGamePlayer({ gameId, userId: guest.id, ... }, ctx); })) y loadSlotSnapshot (línea 19): db.rpc('get_slot_reservation_for_user', { p_game_id: gameId, p_user_id: referral }) — guests y referral provienen del snapshot del cliente y se ejecutan con ctx service-role en confirm_order.

**Impacto:** Un usuario autenticado puede manipular el financial_snapshot que envía a create_order:
(a) Puede poner como `referral` el uuid de cualquier capitán, que es visible en users_public y en los rosters. Así se queda con un cupo de la R1 de ese capitán (counts_reserved_slot=true): ocupa plazas reservadas de un grupo ajeno, y create_order además le suma esa reserva a la capacidad disponible. Encima queda como referred_by_user_id, que decide quién recibe la recompensa grant_referral.
(b) Puede inscribir a cualquier user_id como invitado en partidos sin su consentimiento y mandarle notificaciones 'invited_by_player'. Eso sirve para hacer spam o acoso, y le llena la agenda a la víctima.
No hay robo de dinero ni toma de cuentas (el atacante paga a sus invitados), pero sí abuso de cupos reservados y de la atribución de referidos.

**Fix propuesto:** 1) Referral: que el enlace de referido deje de ser el user_id plano. Crear un token aleatorio de un solo uso y con caducidad, guardado en una tabla `slot_share_links(token, owner_user_id, game_id, expires_at)`. Validarlo en create_order: el `owner_user_id` sale del token, nunca del snapshot. Guardar el referral ya resuelto en una columna propia de orders, fuera de financial_snapshot. En confirm_order, ignorar `financial_snapshot.referral` y usar solo ese valor validado. Mientras no exista el token, que create_order compruebe al menos que el referral tiene una R1 activa en ese juego, que es distinto de auth.uid() y que el usuario no ha usado antes otro referral para ese juego.
2) Guests: en create_order, comprobar que cada guest.id existe en users, que no está repetido, que no es ni el payer ni el host, que no está ya confirmado en game_players de ese juego y, si el producto lo exige, que tiene amistad o vínculo con el payer. Guardar la lista validada en claim_composition, y que confirm_order use solo esa lista y no `financial_snapshot.guests`.
3) Opcional: que el invitado tenga que aceptar (estado 'pending_accept') antes de quedar confirmado y de recibir avisos que no sean la propia invitación.

### 30. referred_by_user_id controlado por el cliente habilita farmeo de recompensas por referido
- **Categoría:** seguridad
- **Ubicación:** `src/services/reservationService.js:359`

**Evidencia:** ...(referredByUserId != null ? { referred_by_user_id: referredByUserId } : {}) en el upsert directo; el valor viene de ?ref= en la URL (src/lib/sharedLink.js:83 guarda pending_game_referral) y migrations/rewards_phase3_referral_auto.sql:75/122 otorga la recompensa por gp.referred_by_user_id.

**Impacto:** El servidor acepta como referido cualquier uid que mande el cliente (?ref= editable o payload modificado). Un jugador puede crear cuentas secundarias, inscribirse con ellas en partidos que igual iba a jugar y poner su cuenta principal como referente. Cuando cada partido termina, cobra la recompensa grant_referral (reward_balance gastable) sin haber referido a nadie. También puede quitarle el referido a quien compartió el enlace de verdad o asignárselo a un tercero. El abuso está acotado: es una recompensa por cuenta nueva, exige que el partido se complete y solo existe cuando el admin activa la recompensa con un monto mayor a 0. Igual es una fuga económica que crece con cuentas desechables.

**Fix propuesto:** Que el cliente no pueda escribir referred_by_user_id. Primero, quitarlo del upsert en reservationService.js:359 y bloquear la columna con un trigger BEFORE INSERT/UPDATE en game_players: si auth.role() no es service_role/postgres, poner NEW.referred_by_user_id = OLD.referred_by_user_id (o NULL al insertar). Además, hacer REVOKE UPDATE (referred_by_user_id) ON game_players FROM authenticated. Segundo, resolver el referido en el servidor: emitir enlaces firmados u opacos (tabla share_links con token, game_id, owner_id y expiración) y registrar el referido con un RPC SECURITY DEFINER que valide el token y el game_id. Tercero, agregar controles anti-abuso en process_referral_rewards: antigüedad mínima de la cuenta del referente, límite de recompensas por referente por periodo, que el referido no comparta método de pago o dispositivo con el referente, y que el referente esté inscrito o sea dueño del enlace de ese partido.

### 31. Notificaciones a terceros con texto libre insertadas desde el cliente
- **Categoría:** seguridad
- **Ubicación:** `src/services/reservationService.js:542`

**Evidencia:** supabase.from('notifications').insert({ recipient_user_id: refundTo, ..., custom_text: `${cancelerFirst} canceló su invitación...` }) — mismo patrón en líneas 523, 679, 808, 846, 935 y src/services/materializeReservation.js:131.

**Impacto:** Cualquier usuario autenticado puede llamar a la API REST de Supabase con el anon key y su JWT, por ejemplo con POST /rest/v1/notifications y recipient_user_id = cualquier UUID (los UUID se obtienen de users_public). Así crea notificaciones source_type='venue' con un template_key oficial (por ejemplo 'venue_changed' o 'guest_invitation_cancelled_by_owner') y un custom_text arbitrario. La víctima las ve en su bandeja como mensajes oficiales de la sede o de AlGrass, por ejemplo: 'Tu reserva fue cancelada, transfiere a X para recuperarla' o un enlace de phishing. Esto permite phishing creíble, envío masivo de spam a todos los usuarios y suplantar avisos operativos (cambio de cancha u horario) para sabotear partidos. Si created_by es opcional, el insert tampoco deja rastro fiable del autor.

**Fix propuesto:** 1) Cambiar la política RLS de notifications: INSERT solo con recipient_user_id = auth.uid(), o mejor, quitar INSERT a authenticated y permitirlo solo a service_role y a funciones SECURITY DEFINER. 2) Llevar las notificaciones a terceros al servidor: generarlas dentro de las RPCs de dominio que ya validan la operación (cancelación de invitado, cancelación del host, materialización de la reserva) o con triggers sobre game_players/reservations. 3) No aceptar custom_text del cliente: guardar template_key más parámetros estructurados (jsonb, por ejemplo {canceler_first_name, credit:true}) que el backend obtiene de la BD, y componer el texto al renderizar. 4) Pasar notifyVenueChanged y los recordatorios next_day_reminder (reservationService.js:846 y :935) a una Edge Function o pg_cron con service_role; hoy dependen de que algún cliente los dispare. 5) Mientras tanto, añadir un CHECK o trigger que obligue a created_by = auth.uid() y que rechace source_type 'algrass'/'venue' cuando el insertante no es staff.

### 32. Validación de eliminación de cuenta solo en el cliente; delete_auth_user invocable directamente
- **Categoría:** seguridad
- **Ubicación:** `src/services/deleteAccountService.js:113`

**Evidencia:** validateDeleteAccount (líneas 8-72) verifica partidos futuros, invitados, saldo y venues en el navegador; executeDeleteAccount anonimiza y llama await supabase.rpc('delete_auth_user') sin que el servidor revalide; además reasigna games.host_user_id desde el cliente (línea 88).

**Impacto:** Las reglas de negocio para eliminar una cuenta solo se aplican en el navegador. Un usuario con reservas de cancha futuras (estado published/reserved), invitados pagados, inscripciones confirmadas o rol de owner/manager de un venue puede borrar su cuenta llamando directo a la RPC delete_auth_user, o a los pasos de la API, sin pasar por esos bloqueos. Eso deja canchas reservadas, partidos e invitados asociados a un usuario que ya no existe, y venues sin responsable. El pipeline tampoco es atómico: los resultados de los pasos 1, 2 y 4 no se revisan, y Settings.jsx:674-676 descarta cualquier error y cierra la sesión igual. Puede quedar un perfil anonimizado con auth.users todavía activo, o venue_staff borrado sin que la cuenta se elimine, sin aviso para el usuario ni para el soporte.

**Fix propuesto:** Reemplazar executeDeleteAccount por una única RPC `delete_my_account()` SECURITY DEFINER (con `SET search_path = public`, `REVOKE ALL ... FROM public, anon` y `GRANT EXECUTE ... TO authenticated`). La función debe usar `auth.uid()` en lugar de un userId que mande el cliente, repetir del lado del servidor las 5 comprobaciones de validateDeleteAccount y lanzar una excepción con un código de bloqueo si alguna falla. Después, dentro de la misma transacción, debe reasignar host_user_id de los partidos futuros, borrar venue_staff, anonimizar public.users y borrar auth.users. Además: revocar EXECUTE de delete_auth_user a authenticated (o eliminarla); confirmar que la RLS de games no permite a usuarios comunes cambiar host_user_id; versionar la función y las políticas en migrations/; y en Settings.jsx confirmDelete, cerrar la sesión solo si la RPC terminó bien y mostrar el error si falló. validateDeleteAccount puede quedarse solo como ayuda visual previa (o llamar a una RPC `check_delete_account()` que reutilice la misma lógica del servidor).

### 33. Códigos promocionales enumerables: lectura directa de la tabla promo_codes
- **Categoría:** seguridad
- **Ubicación:** `full.sql:536`

**Evidencia:** supabase.from('promo_codes').select('id, discount_type, discount_percent, discount_amount, ..., city').eq('code', ...).eq('active', true) — la política 'Anyone can read active promo codes' (full.sql:536) es FOR SELECT USING (active = true) sin restricción de rol.

**Impacto:** Cualquier visitante anónimo, usando la anon key pública del bundle, puede listar todos los códigos promocionales activos con sus porcentajes o montos de descuento, ciudad, ventanas de vigencia y límites de uso (`supabase.from('promo_codes').select('*')`). Así se filtran códigos pensados para campañas privadas o segmentadas (influencers, empresas, ciudades concretas) y se facilita el uso masivo de descuentos no destinados al público, lo que supone una pérdida de ingresos acotada por max_uses_total y max_uses_per_user. También expone la estrategia comercial (descuentos futuros vía starts_at).

**Fix propuesto:** 1) Eliminar la política pública: `DROP POLICY "Anyone can read active promo codes" ON public.promo_codes;` y `REVOKE ALL ON public.promo_codes FROM anon, authenticated;` (dejando acceso solo a service_role/admin mediante una política con un chequeo de rol admin). 2) Crear una RPC `validate_promo_code(p_code text, p_game_id uuid)` SECURITY DEFINER con `set search_path = public` que busque por código exacto, aplique en el servidor la vigencia, el tipo de partido, la ciudad del venue y los límites de uso (reutilizando count_promo_uses), y devuelva solo el id y el descuento aplicable o un código de error; concederla con `GRANT EXECUTE ... TO authenticated` (y a anon solo si hace falta). 3) Sustituir en src/services/reservationService.js:134-160 la consulta directa por `supabase.rpc('validate_promo_code', ...)`. 4) Añadir rate limiting o registrar los intentos fallidos por usuario/IP para evitar la fuerza bruta de códigos. 5) Asegurarse de que create_order recalcula el descuento en el servidor a partir de promo_code_id y no confía en el que envía el cliente.

### 34. Consultas de listado sin paginación expuestas al límite max-rows de PostgREST
- **Categoría:** eficiencia
- **Ubicación:** `src/services/gameService.js:171`

**Evidencia:** getGames/getRentalGames (144-152, 173-181) seleccionan GAME_SELECT con 3 niveles de embed (fields→venues) sin .range/.limit para todo el horizonte; igual fetchChampionshipInventory (src/services/championshipAvailabilityService.js:37-51).

**Impacto:** Cuando el inventario pase de 1000 filas, PostgREST recortará la respuesta en silencio. getRentalGames lo hará primero, porque cada cancha genera cientos de slots por mes. Como la consulta no tiene .order(), las filas que desaparecen son arbitrarias: faltan días o canchas en Fields, PickupGames y el grid de Campeonato, y la app no muestra ningún error. Además, cada carga descarga todas las ciudades y repite en cada fila los datos de venue (dirección, coordenadas, amenities, cover). El payload crece de forma lineal y frena el arranque en móviles.

**Fix propuesto:** 1) Filtrar por ciudad en la fuente dentro de getGames y getRentalGames con el mismo patrón que fetchChampionshipInventory: cambiar el embed de venues a fields:field_id!inner(... venues:venue_id!inner(...)) y añadir .eq('fields.venues.city', city). 2) Añadir siempre .order('date_key').order('time') para que el orden sea estable. Paginar con .range(i, i+999) en un bucle hasta recibir menos de 1000 filas, o cargar el horizonte por tramos (por ejemplo, por semana o por el día seleccionado en la tira de chips). 3) Pedir count: 'exact' (o comprobar data.length === 1000) y registrar un aviso si hubo recorte. 4) Para aligerar el payload, dejar en GAME_SELECT solo field_id/venue_id y resolver venue y field desde un catálogo cacheado (getVenues) que se carga una vez.

### 35. validateDeleteAccount descarga los IDs de TODOS los partidos futuros de la plataforma
- **Categoría:** eficiencia
- **Ubicación:** `src/services/deleteAccountService.js:14`

**Evidencia:** const { data: futureGames } = await supabase.from('games').select('id').gte('date_key', today); const futureIds = ...; luego .in('game_id', futureIds) en las líneas 27 y 39; además executeDeleteAccount hace un UPDATE por partido en bucle (líneas 86-89).

**Impacto:** Cada validación descarga los IDs de todos los partidos futuros de la plataforma (O(N) global) y luego arma URLs .in() con miles de UUID (~37 bytes cada uno). A partir de unos cientos o pocos miles de partidos, la URL supera el límite y la petición falla con 414/400. Además, el tope por defecto de 1000 filas de PostgREST trunca futureIds sin avisar. Como no se revisa el error de ninguna consulta, en los dos casos la validación devuelve 'sin bloqueos': un usuario con partidos futuros confirmados o con invitados pagados puede borrar su cuenta, y quedan plazas o pagos huérfanos. En executeDeleteAccount (líneas 86-89) hay un UPDATE por partido en serie (N+1). No se hace en una transacción ni se revisan errores, así que si falla a mitad quedan partidos reasignados solo en parte.

**Fix propuesto:** 1) Filtrar en el servidor con un join en vez de descargar IDs globales: supabase.from('game_players').select('game_id, games!inner(date_key)').eq('user_id', userId).eq('status','confirmed').gte('games.date_key', today).limit(1). Lo mismo para payer_id con .neq('user_id', userId). 2) Revisar { error } en cada consulta y bloquear el borrado (devolver ['unknown']) si alguna falla. 3) Mejor aún, pasar la validación y el borrado a una RPC SECURITY DEFINER, por ejemplo delete_my_account(), que use auth.uid(). Debe repetir las comprobaciones dentro de la transacción, reasignar hosts con un único UPDATE games g SET host_user_id = f.default_host_user_id FROM fields f WHERE g.field_id = f.id AND g.host_user_id = auth.uid() AND g.date_key >= current_date, anonimizar y borrar de auth.users de forma atómica. Así se elimina el bucle N+1 y no se puede saltar la validación desde el cliente.

### 36. notifyWaitlistUsers: N llamadas RPC por usuario en espera y lógica de cupos en el cliente
- **Categoría:** eficiencia
- **Ubicación:** `src/services/waitlistService.js:82`

**Evidencia:** await Promise.all(toNotify.map(userId => supabase.rpc('notify_waitlist_spot_available', { p_recipient_user_id: userId, p_game_id: gameId }))) precedido de 4 consultas separadas (games, count game_players, get_waitlist_user_ids, notifications) en líneas 44-75.

**Impacto:** Cada cancelación genera 4 + N peticiones desde el móvil de quien cancela, sin await: si la app se cierra o la red cae a mitad, los avisos se pierden en silencio. Con cancelaciones simultáneas, la heurística 0→1 calculada en el cliente puede saltarse la notificación por completo (ambos clientes ven openSpotsBefore > 0) o, por el patrón leer-luego-insertar sin restricción única, enviar avisos duplicados al mismo usuario.

**Fix propuesto:** Mover la lógica al servidor: (a) un trigger AFTER UPDATE OF status ON game_players cuando OLD.status='confirmed' AND NEW.status<>'confirmed', o (b) una única RPC SECURITY DEFINER notify_waitlist(p_game_id) llamada una vez y con await. Dentro: bloquear la fila del partido (SELECT ... FROM games WHERE id=p_game_id FOR UPDATE), calcular cupos libres con COUNT(*) de confirmados e insertar con INSERT INTO notifications (...) SELECT w.user_id, ... FROM game_waitlist w WHERE w.game_id=p_game_id AND w.status='waiting' ON CONFLICT DO NOTHING, añadiendo un índice único parcial en notifications(recipient_user_id, game_id) WHERE template_key='waitlist_spot_available'. Así se elimina el bucle de N RPC, se resuelve la carrera y se deduplica de forma atómica.

### 37. El parámetro ?ref de la URL se usa sin validar como ID de usuario para consultar reservas de terceros y atribuir referidos
- **Categoría:** seguridad
- **Ubicación:** `src/screens/ConfirmReservation.jsx:289`

**Evidencia:** GameDetail.jsx:1320-1321 guarda `new URLSearchParams(location.search).get('ref')` en localStorage sin validar; ConfirmReservation.jsx:289 llama `supabase.rpc('get_slot_reservation_for_user', { p_game_id: gameId, p_user_id: referral })` y l.506 consulta users_public por ese id. La RPC (migrations/get_slot_reservation_for_user.sql) es SECURITY DEFINER, concedida a authenticated y resuelve para cualquier p_user_id sin comprobar relación con auth.uid(). El mismo valor se envía como referral a create_order (l.783).

**Impacto:** Cualquier usuario autenticado puede: (1) leer, por IDOR, el estado de la reserva de cupos de cualquier otro usuario en cualquier partido (IDs de reserva, estados y cupos totales/usados/restantes). (2) Fabricar un ?ref=<uuid de un capitán> o enviar ese referral directamente a create_order para saltarse el NO_CAPACITY de un partido lleno, consumiendo los cupos reservados del grupo privado de un capitán que no compartió su link. El capitán pierde plazas que había reservado para su grupo. La atribución de recompensas a terceros tiene poco impacto, porque el beneficiario sería la víctima y no el atacante.

**Fix propuesto:** Servidor (lo prioritario): (a) quitar el `grant execute` a authenticated en get_slot_reservation_for_user, o devolver datos solo cuando p_user_id = auth.uid(), o cuando el llamador presente una prueba válida de invitación. En cualquier caso, limitar la salida para terceros a effective_reserved_slots_remaining, sin reservation_id ni member_*. (b) En create_order, no confiar en el referral crudo del snapshot: emitir los links desde el servidor (p. ej. un RPC create_share_link que genere un token aleatorio en una tabla share_links(token, user_id, game_id, expires_at), o un HMAC de user_id+game_id). Después, create_order debe resolver el referral a partir de ese token y verificar que corresponde al mismo partido y que el capitán tiene una R1 activa. Cliente: validar que ref tenga formato UUID/token antes de guardarlo en localStorage (GameDetail.jsx:1320) y descartar valores mal formados.

### 38. Los badges de notificaciones y waitlist reconsultan Supabase en cada cambio de ruta
- **Categoría:** eficiencia
- **Ubicación:** `src/App.jsx:98`
- **Detectado por 2 auditores independientes**

**Evidencia:** NotifBadgeSync: `useEffect(() => { ... supabase.from('notifications').select('id', { count: 'exact', head: true })... }, [user?.id, pathname, fgTick]);` y WaitlistBadgeSync l.108-111 `hasAvailableWaitlistSpot(user.id)` con deps `[user?.id, pathname, fgTick]`.

**Impacto:** Cada navegación interna (abrir un detalle, back/forward, cambio de pestaña) lanza 1 COUNT sobre notifications y hasta 3 consultas de waitlist (getMyWaitlistGameIds, games y game_players; src/services/waitlistService.js:105-119). Son hasta 4 peticiones extra por navegación y por usuario, aunque nada haya cambiado. Esto multiplica la carga de PostgREST/Postgres en proporción a las páginas vistas en vez de a los cambios reales, consume datos y batería en móvil y compite con las peticiones de la pantalla destino. Si notifications(recipient_user_id, read_at) no tiene índice, el COUNT exact además hace scans que crecen con la tabla.

**Fix propuesto:** Quitar `pathname` de las dependencias en src/App.jsx:98 y src/App.jsx:111, y dejar solo `[user?.id, fgTick]`. Para el badge de notificaciones, suscribirse a Supabase Realtime (`supabase.channel(...).on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `recipient_user_id=eq.${user.id}` }, refetch)`) y refrescar al salir de /notifications (por ejemplo, con un evento emitido tras marcar como leídas), en lugar de hacerlo en cada ruta. Para la waitlist, refrescar tras join/leave de waitlist o cambios en game_players (realtime o un evento local), o aplicar un TTL mínimo (por ejemplo 60 s) entre recálculos. Mejor aún, mover hasAvailableWaitlistSpot a una única RPC SQL que devuelva un booleano (1 petición en vez de 3). Verificar que existe un índice parcial `CREATE INDEX ON notifications(recipient_user_id) WHERE read_at IS NULL` para que el COUNT sea barato.

_Hallazgos relacionados que se fusionaron aquí:_ Los badges globales vuelven a consultar Supabase en cada cambio de ruta (de 4 a 5 peticiones por navegación)

### 39. Perfil lanza una ráfaga de más de 12 consultas sin límite en cada montaje y cada vuelta a primer plano, y otro efecto repite la mitad
- **Categoría:** eficiencia
- **Ubicación:** `src/screens/Profile.jsx:2426`

**Evidencia:** El useEffect de las líneas 2426-2675 (deps `[fgTick]`) lanza en paralelo: fetchMyRatings, users, wallet_summary, games (rental) + reservations, reservations + reservations(refund), game_players `.or(`user_id.eq.${uid},payer_id.eq.${uid}`)` (L2575, sin filtro de fecha ni .limit) + users_public, games hosted + game_players, y getMyWaitlistGamesFull + game_players. El efecto de L2678 (deps `[confirmedGame?.id]`) vuelve a lanzar las mismas consultas de rentals/reservations/game_players (L2690, L2745). Ninguno tiene un flag `alive`, así que los setState pueden llegar después del desmontaje.

**Impacto:** Cada vez que se monta Perfil y cada vez que la app vuelve de segundo plano salen unas 13 peticiones a Supabase, varias de ellas en cascada (2 o 3 viajes de ida y vuelta). Siempre se descarga el historial completo de game_players y reservations del usuario, con joins anidados a games/fields/venues, así que la latencia, el uso de datos móviles y la carga en PostgREST crecen con la antigüedad de la cuenta. Al volver de una reserva (confirmedGame) se disparan además 4 o 5 consultas duplicadas. Como no hay cancelación, una respuesta vieja que llegue tarde puede pisar el estado de una más reciente (por ejemplo, setMyPlayerRows o setRentalCards con datos anteriores) y también se pueden ejecutar setState después del desmontaje.

**Fix propuesto:** 1) Pasar todo a una función loadProfileData(uid, {signal}) que usen los dos efectos. El efecto de L2678 debe limitarse a volver a llamarla (o a invalidar la caché) en lugar de duplicar las consultas. 2) Acotar el historial: en game_players y reservations, filtrar por fecha con .gte('games.date_key', hace N días) usando !inner en el embed, y añadir .order('created_at', {ascending:false}).limit(N), con paginación o "ver más" para lo antiguo. 3) Calcular los confirmados en SQL con una RPC o vista que devuelva count(*) agrupado por game_id, en vez de traer filas de game_players solo para contarlas (L2600 y L2632). Lo ideal es una única RPC get_my_profile_feed(p_from date). 4) Añadir `let alive = true; return () => { alive = false; }` y comprobar alive antes de cada setState, o usar React Query/SWR con staleTime (por ejemplo 60 s), para que un fgTick dentro de esa ventana no vuelva a pedir los datos y las respuestas desordenadas no pisen datos frescos.

### 40. El feed de partidos descarga los partidos de todas las ciudades y todas las filas de confirmados para contarlas en el cliente
- **Categoría:** eficiencia
- **Ubicación:** `src/screens/PickupGames.jsx:1083`

**Evidencia:** L1017-1025: `getGames({ isCaptain })` (gameService.js L142-151) solo filtra por tipo, estado y rango de fechas, no por ciudad. La ciudad se filtra en el cliente en L1276 (`if (userCity && g.city && g.city !== userCity) return false`). Luego, en L1083-1099: `supabase.from('game_players').select('game_id').eq('status','confirmed').in('game_id', games.map(g => g.id))` y `data.forEach(r => map.set(r.game_id, (map.get(r.game_id) ?? 0) + 1))`.

**Impacto:** Cada carga del feed y cada vuelta al primer plano (fgTick) descarga los partidos de todas las ciudades de los próximos 30 días y, además, una fila por cada jugador confirmado, solo para contarlas en el navegador. El payload y la latencia crecen de forma lineal con la plataforma, no con lo que el usuario ve. Al crecer, el conteo falla de dos formas: (a) si hay más de unas 1000 filas confirmadas, PostgREST corta la respuesta sin avisar (max_rows) y los contadores de confirmados y cupos libres salen más bajos de lo real; (b) si hay unos 200 partidos o más, la lista `in.(...)` excede el límite de longitud de URL, la petición falla y el error se ignora sin avisar, así que el feed muestra contadores viejos (sessionStorage) o vacíos.

**Fix propuesto:** 1) Filtrar por ciudad en el servidor: pasar `city` a getGames y usar un embed con inner join, por ejemplo `fields!inner(venues!inner(city))` con `.eq('fields.venues.city', city)`, o desnormalizar `city` en games con un índice (city, date_key). 2) Sustituir la descarga de filas por un conteo agregado en el servidor: una RPC `game_confirmed_counts(p_game_ids uuid[]) returns table(game_id uuid, confirmed int)` con `SELECT game_id, count(*) FROM game_players WHERE status='confirmed' AND game_id = ANY(p_game_ids) GROUP BY game_id`, que se invoca con supabase.rpc (POST, sin límite de URL y con una fila por partido). Otra opción es una columna `confirmed_count` mantenida por trigger, o exponer el conteo en public_availability, e incluirla directamente en GAME_SELECT para ahorrarse la segunda petición. 3) Mientras tanto, tratar el error en lugar de ignorarlo (marcar los contadores como no frescos) y trocear los IDs en lotes de unos 100 si se mantiene el enfoque actual.

### 41. La búsqueda de jugadores consulta en cada tecla, sin debounce ni control de respuestas obsoletas
- **Categoría:** eficiencia
- **Ubicación:** `src/screens/ConfirmReservation.jsx:88`

**Evidencia:** `useEffect(() => { if (!q) {...} searchUsers(q, { excludeIds: [...selectedIds] }).then(results => { setSbResults(results); ... }) }, [q]);` (L88-99). searchUsers (reservationService.js L193-206) hace además `getSession()` y un `.or('full_name.ilike.%q%,user_code.ilike.%q%')`.

**Impacto:** Cada tecla dispara una petición a Supabase: escribir 'juan perez' genera unas 10 consultas a users_public con ILIKE '%...%' sobre full_name y user_code. Con el comodín inicial no se puede usar un índice B-tree. No hay índice pg_trgm en las migraciones, así que la base de datos probablemente recorre toda la tabla de usuarios en cada consulta, y el coste crece con el número de usuarios. Además, como el efecto no descarta las respuestas obsoletas, si la respuesta de 'ju' llega después de la de 'juan', la lista muestra resultados que no corresponden al texto escrito. El usuario puede añadir a alguien que no buscaba o creer que el jugador no existe.

**Fix propuesto:** Aplicar el mismo patrón que ChampionshipTeam.jsx (líneas 289-299): `useEffect(() => { if (!q) { setSbResults([]); return; } let alive = true; const t = setTimeout(() => { searchUsers(q, { excludeIds: [...selectedIds] }).then(results => { if (!alive) return; setSbResults(results); setSbPlayerMap(prev => { ... }); }).catch(...); }, 300); return () => { alive = false; clearTimeout(t); }; }, [q]);`. Opcionalmente, exigir q.length >= 2 antes de consultar. Si searchUsers acepta un AbortSignal, también se puede usar AbortController con `.abortSignal(signal)` de supabase-js. En la base de datos, crear `CREATE EXTENSION IF NOT EXISTS pg_trgm;` y los índices `CREATE INDEX users_full_name_trgm ON public.users USING gin (lower(full_name) gin_trgm_ops);` y `CREATE INDEX users_user_code_trgm ON public.users USING gin (user_code gin_trgm_ops);`. Las expresiones deben coincidir exactamente con las que exponga la vista users_public (aquí el cliente ya envía qDb sin acentos y en minúsculas). Por último, eliminar el console.debug de searchUsers en producción.

### 42. Volcados completos del esquema de BD y archivos basura commiteados en la raíz ('-', full.sql, tatus)
- **Categoría:** seguridad
- **Ubicación:** `full.sql:1`, `supabase/functions/confirm_order/index-credit-backup.ts:1`
- **Detectado por 2 auditores independientes**

**Evidencia:** `git ls-files` incluye `-` (40 KB, pg_dump del esquema público con funciones, grants y políticas RLS), `full.sql` (21 KB, otro dump) y `tatus` (salida accidental de `git branch` con códigos ANSI). Añadidos en el commit 9884c45 'Add email assets'. Son estos dumps los que revelan los dos fallos críticos anteriores.

**Impacto:** Como el repositorio es público, cualquiera puede leer el código completo de las funciones SECURITY DEFINER (por ejemplo apply_wallet_refund y handle_new_user), los GRANT ALL a anon y las políticas RLS. Eso le da a un atacante un mapa exacto para explotar los fallos de autorización que existan en la base de datos. No se filtran credenciales. Además son artefactos obsoletos y basura (`tatus`, un archivo llamado `-`) que no coinciden con migrations/ y generan confusión sobre el esquema vigente.

**Fix propuesto:** 1. Borrar los archivos del repo con `git rm -- ./- full.sql tatus` y añadir a .gitignore las entradas `/full.sql`, `/-`, `/tatus` y `/*.sql` (solo la raíz). 2. Mantener el esquema únicamente en migrations/ o supabase/migrations. 3. El historial de un repo público ya está expuesto, así que lo importante es corregir los fallos de RLS y grants que muestran los dumps: revocar EXECUTE a anon y public en las funciones sensibles y revisar las políticas. Reescribir el historial con git filter-repo es opcional y tiene poco valor una vez corregido lo anterior. 4. Opcional: hacer el repo privado.

_Hallazgos relacionados que se fusionaron aquí:_ Archivos sobrantes commiteados: backup de Edge Function, lock de Office y carpeta Docs con HTML/imágenes

### 43. vercel.json sin cabeceras de seguridad (CSP, X-Frame-Options/frame-ancestors, nosniff, Referrer-Policy, Permissions-Policy)
- **Categoría:** seguridad
- **Ubicación:** `vercel.json:1`

**Evidencia:** vercel.json solo contiene `"rewrites": [{ "source": "/((?!api/).*)", "destination": "/index.html" }]`; no hay bloque `headers`. index.html tampoco define meta CSP.

**Impacto:** La SPA, incluido el flujo de pago de src/components/checkout/PaymentSheet.jsx, se puede embeber en un iframe de un dominio ajeno. Eso permite clickjacking, por ejemplo para engañar al usuario y que confirme una reserva o un pago. Como no hay CSP, cualquier XSS futuro (de una dependencia o de contenido renderizado) podría ejecutar código y mandar a cualquier dominio el JWT de Supabase que se guarda en localStorage, lo que termina en robo de sesión. Faltan además medidas de defensa en profundidad: nosniff y una Permissions-Policy que limite la geolocalización (la usa el mapa) al propio origen. El riesgo de que el Referrer filtre IDs es bajo, porque el navegador ya aplica strict-origin-when-cross-origin por defecto. Aun así, conviene declararlo de forma explícita.

**Fix propuesto:** Añadir a vercel.json, junto a `rewrites`, un bloque `"headers"` con source "/(.*)" que incluya:
- Content-Security-Policy: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://*.supabase.co https://tile.openstreetmap.org; media-src 'self' https://*.supabase.co; connect-src 'self' https://<ref>.supabase.co wss://<ref>.supabase.co; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`
- X-Frame-Options: DENY
- X-Content-Type-Options: nosniff
- Referrer-Policy: strict-origin-when-cross-origin
- Permissions-Policy: camera=(), microphone=(), geolocation=(self), payment=()
- Strict-Transport-Security: max-age=63072000; includeSubDomains

Recomiendo desplegarla primero como Content-Security-Policy-Report-Only en un preview para detectar orígenes que falten (pasarelas de pago, analytics, el service worker de la PWA). Cuando quede limpia, pasarla a modo enforce.

### 44. Service Worker precachea ~1,3 MB de PNG de correos que la SPA nunca usa
- **Categoría:** eficiencia
- **Ubicación:** `vite.config.js:30`

**Evidencia:** `globPatterns: ['**/*.{js,css,html,svg,png,woff2}']` solo excluye videos. public/ incluye public/email-assets/bienvenida-partidos.png (416 KB, 1120x800), capitanes-tutorial.png (403 KB), public/email-logo.png (187 KB, 512x768), email-assets/email-logo.png y logo.png (17 KB c/u, duplicados), icons.svg; ninguno se referencia desde src/ (grep sin resultados).

**Impacto:** Cuando el usuario visita la app por primera vez o instala la PWA, el Service Worker descarga en segundo plano unos 1,04 MB de imágenes que la SPA nunca muestra. Están pensadas para correos (bienvenida-partidos.png, capitanes-tutorial.png, email-logo.png, logo.png). Esto gasta datos móviles, ocupa espacio en Cache Storage y retrasa la instalación y activación del SW. Si alguno de estos archivos cambia, se vuelve a descargar en la siguiente actualización. Además, las versiones .jpg (112-117 KB) ya existen y también se publican, y hay un logo de 16 KB duplicado.

**Fix propuesto:** En vite.config.js:31, ampliar la lista de exclusiones: `globIgnores: ['**/videos/**', '**/*.mp4', '**/email-assets/**', 'email-logo.png', 'icons.svg']`. Antes de excluir icons.svg, confirmar que no se usa en tiempo de ejecución. Otra opción es mover los assets de correo a un bucket público de Supabase Storage o a un CDN y quitarlos de public/. Además, en los correos usar las versiones .jpg (unos 115 KB) en lugar de los PNG de unos 400 KB y eliminar el duplicado email-assets/email-logo.png o logo.png (16.713 B cada uno). Verificación: tras `vite build`, revisar que en dist/sw.js ya no aparezcan entradas de email-assets en el manifiesto de precache.

## Bajo

### 45. Conflicto de versiones: update_championship_team_secret puede reescribir el hash en vez del texto
- **Categoría:** seguridad
- **Ubicación:** `migrations/championships_team_update_secret.sql:53`

**Evidencia:** Ambos archivos se añadieron en el mismo commit (1df9c59, 2026-10-06 15:44:43). championships_team_update_secret.sql redefine update_championship_team_secret con `set join_secret_hash = public._championship_hash_secret(v_secret)` (l.53), mientras que el join vigente valida contra join_secret en texto (championships_free_join_registration_closed.sql:63-66). En orden alfabético este archivo se aplica DESPUÉS de championships_team_join_secret_plaintext.sql.

**Impacto:** Riesgo latente de despliegue. Si championships_team_update_secret.sql se vuelve a aplicar después de championships_team_join_secret_plaintext.sql (por ejemplo al montar un entorno nuevo en orden alfabético, porque no hay ejecutor ni prefijos de orden), update_championship_team_secret volvería a escribir solo join_secret_hash. En ese caso, cuando el owner cambia la clave tras una filtración, la clave antigua (join_secret, en texto) seguiría permitiendo unirse al equipo y get_championship_team_secret seguiría mostrando la vieja, sin ningún error. Además, el bloque de verificación del archivo antiguo daría por buena esa regresión. No hay evidencia de que hoy esté aplicado en ese orden en producción.

**Fix propuesto:** 1) Mover championships_team_update_secret.sql (y las versiones antiguas de confirm/create que escriben join_secret_hash, como championships_team_reservation_unit_price.sql) a una carpeta migrations/superseded/, o añadir al principio un guard que aborte si ya existe la columna join_secret: `if exists (select 1 from information_schema.columns where table_name='championship_teams' and column_name='join_secret') then raise exception 'Obsoleta: sustituida por championships_team_join_secret_plaintext.sql'; end if;`. 2) Adoptar nombres con prefijo de timestamp (YYYYMMDDHHMM_...) o supabase/migrations con la CLI para que el orden quede fijado. 3) Comprobar en producción: `select pg_get_functiondef('public.update_championship_team_secret(uuid,text)'::regprocedure) ~ 'join_secret = v_secret';` debe devolver true.

### 46. verify_championship_access es un oráculo anónimo para fuerza bruta de registration_key
- **Categoría:** seguridad
- **Ubicación:** `migrations/championships_phase9_registration.sql:214`

**Evidencia:** verify_championship_access(uuid, text) devuelve `v_typed = btrim(v_champ.registration_key)` (l.213) y se concede `to anon, authenticated` (l.217). La clave no tiene longitud mínima: update_championship_privacy solo hace `nullif(btrim(...),'')` (migrations/championships_results_public_states.sql:29).

**Impacto:** Un usuario anónimo puede llamar a verify_championship_access sin límite y recuperar por fuerza bruta la registration_key de un campeonato privado (las claves cortas se descifran rápido), porque no hay rate limit ni longitud mínima. El daño directo es limitado: la clave no protege nada en el servidor (lecturas abiertas a anon e inscripción sin comprobar la clave), así que adivinarla solo sirve para pasar la cortina de la UI y para conocer un secreto que el owner podría reutilizar. La "privacidad" de un campeonato privado da una falsa sensación de seguridad.

**Fix propuesto:** 1) Si la clave debe proteger algo de verdad, comprobarla en el servidor dentro de las RPCs de inscripción y unión (join_championship_team_with_secret/_with_token, create_championship_team_registration_order, inscripción individual) y en get_championship_registration_state/get_championship_competition cuando privacy='private'. Por ejemplo, mediante una tabla championship_access_grants(user_id, championship_id) que se rellene cuando verify_championship_access acierte. 2) Retirar a anon el EXECUTE de verify_championship_access (`revoke execute on function public.verify_championship_access(uuid, text) from anon;`) para que los intentos vayan ligados a un auth.uid(). 3) Limitar los intentos con una tabla championship_key_attempts(user_id, championship_id, ts) y rechazar a partir de unos 5 fallos en 15 minutos. 4) Exigir en update_championship_privacy y publish_championship `char_length(v_key) >= 8` (o generar la clave en el servidor) y guardarla como hash (crypt/gen_salt, como ya se hace con _championship_hash_secret) en lugar de en texto plano.

### 47. users_update_own permite modificar cualquier columna de la propia fila (role, organizer_status, credit_balance, confirmed_email)
- **Categoría:** seguridad
- **Ubicación:** `full.sql:590`

**Evidencia:** `CREATE POLICY "users_update_own" ON public.users FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());` sin restricción de columnas y con GRANT ALL a authenticated (l.864). La tabla incluye role, organizer_status, credit_balance (l.321-323); migrations/users_confirmed_email.sql:9-10 confirma que confirmed_email se escribe con esta misma policy.

**Impacto:** La policy permite que un usuario autenticado haga UPDATE de cualquier columna de su propia fila en public.users: role, organizer_status, credit_balance (legacy), email, confirmed_email y user_code. Hoy no hay escalada explotable. Los permisos reales salen de public.user_roles, el saldo real sale de wallet_summary y confirmed_email solo controla un aviso de UX. El usuario sí puede falsear datos que otros ven, como un user_code arbitrario o confuso, que es UNIQUE y aparece en la búsqueda de jugadores, o un email desalineado con auth.users. Además, cualquier lógica futura (SQL o frontend) que confíe en role, organizer_status, credit_balance o confirmed_email quedaría comprometida sin que nadie lo note. El GRANT ALL a anon no es explotable porque auth.uid() es null para anon.

**Fix propuesto:** Limitar la escritura por columnas sin romper los flujos legítimos del cliente. Opción A, con grants por columna: `revoke update on public.users from anon, authenticated; grant update (full_name, birth_date, sex, preferred_position, phone, nationality, occupation, avatar_hue, avatar_path, avatar_updated_at, city, address_city, address_line, district, confirmed_email) on public.users to authenticated;`. Antes hay que mover a RPCs SECURITY DEFINER las escrituras que hoy hace el cliente sobre columnas sensibles: la asignación de user_code (utils/format.js:56) a un RPC que use generate_user_code; la sincronización de email (AuthContext.jsx:73) a un RPC que copie auth.users.email; y el anonimizado de deleteAccountService.js (~l.107) a un RPC. Opción B, menos invasiva: un trigger BEFORE UPDATE en public.users que, cuando current_setting('request.jwt.claim.role', true) no sea 'service_role', lance una excepción si cambian role, organizer_status, credit_balance o email (salvo que email = (select email from auth.users where id = auth.uid())). El mismo trigger debe permitir user_code solo cuando OLD.user_code is null, y forzar que confirmed_email solo pueda tomar null o el valor de auth.users.email. Conviene además eliminar la columna legacy users.credit_balance y su UPDATE en handle_guest_cancellation (full.sql:158-160), porque wallet_summary ya es la fuente de verdad.

### 48. wallet_insert_own permite al usuario insertar movimientos 'refund'/'adjustment' arbitrarios
- **Categoría:** seguridad
- **Ubicación:** `full.sql:594`

**Evidencia:** `CREATE POLICY "wallet_insert_own" ON public.wallet_transactions FOR INSERT WITH CHECK (user_id = auth.uid());` sin restricción de type ni amount (CHECK admite 'refund','spend','adjustment', l.364).

**Impacto:** Cualquier usuario autenticado puede insertar en su propio wallet_transactions filas arbitrarias (type 'refund' o 'adjustment', con cualquier importe) mediante la API REST de Supabase. Hoy esto no da crédito que se pueda gastar: la app y confirm_order usan la tabla wallet_summary, no este ledger. El efecto se limita a contaminar un historial legacy y cualquier reporte o conciliación que se construya sobre él. El riesgo aumenta si full.sql se usa para recrear el esquema: ahí wallet_summary es una vista que suma wallet_transactions, y confirm_order aceptaría ese crédito falso como saldo real (pérdida de dinero).

**Fix propuesto:** Quitar la escritura directa desde el cliente: `drop policy if exists wallet_insert_own on public.wallet_transactions; revoke insert, update, delete on public.wallet_transactions from anon, authenticated;`. Así la tabla solo la escriben funciones SECURITY DEFINER o service_role, como el trigger handle_guest_cancellation. Si la tabla es legacy y sin uso, retirarla junto con el trigger. Además, regenerar full.sql desde producción (`supabase db dump`) para que wallet_summary aparezca como tabla con su RLS real, y evitar que un entorno nuevo reciba la vista derivada del ledger.

### 49. Funciones SECURITY DEFINER sin search_path fijo y ejecutables por anon
- **Categoría:** seguridad
- **Ubicación:** `full.sql:56`

**Evidencia:** generate_user_code (l.55-56) y handle_guest_cancellation (l.108-109) son `SECURITY DEFINER` sin `SET search_path` y referencian objetos sin calificar (`users`, `reservations`, `wallet_transactions`, `unaccent`); GRANT ALL a anon (l.760, l.766). El `set_config('search_path','',false)` de l.9 solo aplica a la sesión del dump.

**Impacto:** Es una mala práctica de endurecimiento. Dos funciones SECURITY DEFINER propiedad de postgres resuelven objetos sin calificar usando el search_path de quien las llama. Si en algún momento un rol con permiso de CREATE en algún esquema del search_path (o en pg_temp con acceso SQL directo) crea un `users`, `reservations` o `unaccent` con el mismo nombre, ese código se ejecutaría con privilegios de postgres. Hoy no se puede explotar desde la API pública. Además, cualquier anónimo puede invocar generate_user_code por /rest/v1/rpc. Eso permite inferir de forma limitada qué user_codes no existen y lanzar consultas repetidas sobre users (hasta 50 por llamada).

**Fix propuesto:** Crear una migración con: `alter function public.generate_user_code(text) set search_path = public, pg_temp;` y `alter function public.handle_guest_cancellation() set search_path = public, pg_temp;` (pg_temp al final). Mejor aún: calificar las referencias como `public.users`, `public.reservations`, `public.wallet_transactions` y `public.unaccent(...)` dentro de los cuerpos. Quitar la ejecución pública: `revoke execute on function public.generate_user_code(text) from public, anon, authenticated;` (dejarla solo para service_role o para el trigger handle_new_user que la usa) y `revoke execute on function public.handle_guest_cancellation() from public, anon, authenticated;`.

### 50. Funciones de barrido (expire_orders, expire_waitlists) invocables por cualquier usuario
- **Categoría:** seguridad
- **Ubicación:** `migrations/expire_order.sql:52`

**Evidencia:** `grant execute on function public.expire_orders() to authenticated;` (l.52) y `grant execute on function public.expire_waitlists() to authenticated;` (migrations/waitlist_expired.sql:31); ambas son SECURITY DEFINER con UPDATE masivo, y ya están programadas por pg_cron (migrations/expire_orders_cron.sql:30).

**Impacto:** Cualquier usuario autenticado, y probablemente también anon por el EXECUTE por defecto a PUBLIC, puede llamar en bucle a expire_orders() y expire_waitlists() vía /rest/v1/rpc. Cada llamada recorre orders y game_waitlist (con JOIN a games) y toma locks de fila. Eso genera carga y contención innecesarias sobre tablas calientes y compite con confirm_order. No permite expirar órdenes válidas ni alterar datos que no cumplan las condiciones, así que no hay fuga de datos ni pérdida de dinero. Además, la expiración de la waitlist depende hoy de que algún cliente abra la app, no de un proceso del servidor.

**Fix propuesto:** 1) Nueva migración para expire_orders: `revoke all on function public.expire_orders() from public, anon, authenticated;` (el cron de migrations/expire_orders_cron.sql corre como postgres y sigue funcionando). 2) Para expire_waitlists, primero agendarla en pg_cron, por ejemplo `select cron.schedule('expire-waitlists', '*/5 * * * *', $$ select public.expire_waitlists(); $$);` con el mismo patrón unschedule-previo. Después, `revoke all on function public.expire_waitlists() from public, anon, authenticated;` y quitar la llamada `supabase.rpc('expire_waitlists')` de src/App.jsx:115-128. Es el mismo patrón que ya usan expire_slot_reservations y expire_championship_gateway_holds.

### 51. Policies RLS evalúan auth.uid() por fila y duplicadas en reservations
- **Categoría:** eficiencia
- **Ubicación:** `full.sql:571`
- **Detectado por 2 auditores independientes**

**Evidencia:** `reservations_select_own ... USING (user_id = auth.uid())` (l.571) duplica `users can read own reservations ... USING (auth.uid() = user_id)` (l.582); igual INSERT (l.567 y l.578). Otras policies usan `auth.uid()` sin subselect: migrations/orders.sql:94, rewards_phase1.sql:116, captain_requests.sql:54.

**Impacto:** En reservations, cada SELECT o INSERT del rol authenticated evalúa dos políticas permisivas equivalentes. Postgres las combina con OR y en cada una llama a auth.uid() fila por fila, en lugar de una sola vez por consulta. Con muchas reservas, los listados y los escaneos son más lentos y los planes peores; el Supabase Advisor lo marca como auth_rls_initplan y multiple_permissive_policies. Tener políticas duplicadas también complica el mantenimiento: si en el futuro se endurece una, la otra puede seguir dejando pasar el acceso (el OR sigue permitiéndolo). No hay impacto directo de seguridad, porque las condiciones son idénticas.

**Fix propuesto:** Crear una migración nueva que: 1) elimine los duplicados con `drop policy "reservations_insert_own" on public.reservations; drop policy "reservations_select_own" on public.reservations;` y conserve las versiones `TO authenticated`; 2) reescriba las que quedan con InitPlan: `alter policy "users can read own reservations" on public.reservations using (user_id = (select auth.uid()));`, `alter policy "users can insert own reservations" on public.reservations with check (user_id = (select auth.uid()));` y lo mismo para `"Users can update own reservations"` (l.540), añadiendo además `with check`. Hacer el mismo cambio a `(select auth.uid())` en migrations/orders.sql:94, rewards_phase1.sql:116 y captain_requests.sql:54. Comprobar que existe un índice sobre reservations(user_id) y revisar el Supabase Advisor después del cambio.

_Hallazgos relacionados que se fusionaron aquí:_ Políticas RLS llaman a auth.uid() por fila y hay políticas permisivas duplicadas en reservations

### 52. Bucket privado de comprobantes sin límite de tamaño ni tipos MIME
- **Categoría:** seguridad
- **Ubicación:** `migrations/championship_payment_proofs_bucket.sql:18`

**Evidencia:** `insert into storage.buckets (id, name, public) values ('championship-payment-proofs', 'championship-payment-proofs', false)` sin file_size_limit ni allowed_mime_types, a diferencia de championship-covers (migrations/championships_phase8_cover_image.sql:21-22: 8 MB e image/*). La policy de insert (l.24-29) permite subir cualquier objeto bajo el prefijo propio.

**Impacto:** La validación de tipo y tamaño (JPG/PNG/WEBP/PDF, como máximo 10 MB) solo existe en el cliente (src/utils/championshipProof.js:13-17). Un usuario autenticado puede saltársela llamando directamente a la API de Storage y subir bajo su prefijo {uid}/ archivos de cualquier tipo (HTML, SVG con scripts, ejecutables) y de cualquier tamaño hasta el límite global del proyecto. Como no hay límite de cantidad, puede repetir subidas y gastar la cuota de Storage. Además, el staff que abra esos "comprobantes" desde AlGrass-Admin con una signed URL puede recibir contenido malicioso. Ese contenido se sirve desde el dominio de Storage, así que el riesgo de XSS sobre la app es bajo.

**Fix propuesto:** Hacer que el servidor aplique las mismas restricciones que el cliente, con una migración nueva: `update storage.buckets set file_size_limit = 10485760, allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf'] where id = 'championship-payment-proofs';`. Se usan 10 MB para que coincida con PROOF_MAX_BYTES; si se baja a 5 MB, hay que actualizar también championshipProof.js. Opcionalmente, endurecer la policy champ_proofs_owner_insert para exigir la ruta exacta {uid}/{championship_id}/{archivo}. Por ejemplo: `array_length(storage.foldername(name),1) = 2`, una extensión válida con `lower(storage.extension(name)) in ('jpg','png','webp','pdf')`, y que el championship_id del segundo segmento pertenezca a auth.uid() en public.championships. En AlGrass-Admin, generar las signed URLs con la opción `download: true` para que el navegador descargue el archivo en lugar de abrirlo.

### 53. expire_waitlists: UPDATE global no sargable disparado por cada inicio de sesión
- **Categoría:** eficiencia
- **Ubicación:** `migrations/waitlist_expired.sql:22`

**Evidencia:** waitlist_expired.sql:22-28: `update game_waitlist w set status='expired', left_at = ((g.date_key::date + g.time) at time zone 'America/Lima') from games g where w.game_id = g.id and w.status = 'waiting' and ((g.date_key::date + g.time) at time zone 'America/Lima') <= now();` L31: `grant execute ... to authenticated`. src/App.jsx:121: `supabase.rpc('expire_waitlists')` en cada sesión.

**Impacto:** Cada carga de la app con sesión activa (src/App.jsx:121) ejecuta un barrido global de game_waitlist con join a games. Ese join usa un predicado de tiempo calculado que no es indexable. Normalmente no escribe nada, porque las filas ya están expiradas, pero el costo de lectura crece con el número de sesiones y con el tamaño de game_waitlist en lugar de ser constante. Además, como la RPC está concedida a authenticated (L31), cualquier usuario puede invocarla en bucle y generar carga inútil en la base de datos. Con el volumen actual el impacto es bajo; se vuelve relevante si la tabla crece o si alguien la abusa.

**Fix propuesto:** Mover el barrido a un job de pg_cron que corra cada 1 a 5 minutos, siguiendo el patrón de rewards_phase3_referral_auto.sql:245. Después, quitar la llamada de src/App.jsx:116-127 y ejecutar `revoke execute on function public.expire_waitlists() from authenticated, anon, public;`. Para que el barrido sea barato, crear el índice parcial `create index on game_waitlist(game_id) where status = 'waiting';` y, si se quiere, añadir `games.starts_at timestamptz`, mantenida por trigger o como columna generada, con su propio índice, para filtrar con `g.starts_at <= now()`. Si se decide mantener la llamada desde el cliente, al menos añadir una guarda que haga un `return` temprano cuando no exista ninguna fila 'waiting' vencida (`if not exists(...)`), para no ejecutar el UPDATE.

### 54. reserve_slots no comprueba expires_at: la R1 vencida sigue editable hasta el siguiente cron horario
- **Categoría:** eficiencia
- **Ubicación:** `migrations/reserve_slots_hold_aware.sql:129`

**Evidencia:** reserve_slots_hold_aware.sql:129-131 solo bloquea `if v_r1_exists and v_existing.released_reason = 'automatic' then raise exception 'SLOT_RESERVATION_EXPIRED'`. No compara `v_existing.expires_at <= now()`. slot_reservations_cron.sql:23 programa el barrido `'0 * * * *'` (cada hora).

**Impacto:** El cron horario es el único lugar que hace cumplir el deadline de la R1 (expires_at = game_start − captain_release_hours / captain_gold_release_hours). Durante hasta ~60 minutos después de ese deadline, el capitán puede seguir ampliando su R1 con reserve_slots, que en ese tramo no revisa expires_at. Así retiene cupos públicos que ya deberían estar libres. Además, las R1 vencidas de otros capitanes siguen en status 'active' y su reserved_slots_remaining sigue sumando en v_held (líneas 160-165), lo que reduce la capacidad pública disponible para otros jugadores. Todo esto ocurre en la ventana previa al partido, cuando hay más demanda. No hay fuga de datos ni pérdida económica directa: es una brecha de regla de negocio y de disponibilidad.

**Fix propuesto:** 1) En reserve_slots, justo después de las líneas 129-131, añadir: `if v_r1_exists and v_existing.status = 'active' and v_existing.expires_at is not null and v_existing.expires_at <= now() and p_reserved_slots_total > 0 then raise exception 'SLOT_RESERVATION_EXPIRED'; end if;`. No conviene llamar a release_slot_reservation() antes del RAISE porque la excepción revierte la liberación. Hay dos opciones: dejar que el cron la libere, o liberar y devolver la fila sin lanzar error. Hay que decidir también si una R1 'inactive' con expires_at vencido puede reactivarse; hoy sí puede, y el cron la libera en la siguiente hora. 2) En el cálculo de v_held (líneas 160-165), y en el equivalente de create_order, excluir las R1 vencidas añadiendo `and (expires_at is null or expires_at > now())`. Así la capacidad pública queda correcta aunque el cron aún no haya pasado. 3) Opcionalmente, programar expire-slot-reservations cada 1-5 minutos en slot_reservations_cron.sql:23 (por ejemplo '*/5 * * * *'). El índice parcial game_slot_reservations_active_expiry_idx (game_slot_reservations_expires_at.sql:22-24) mantiene el barrido barato.

### 55. Notificaciones fire-and-forget en Edge Function pueden perderse al terminar la petición
- **Categoría:** eficiencia
- **Ubicación:** `src/services/materializeReservation.js:123`

**Evidencia:** db.from('notifications').insert({...}).then(...) sin await (L123-139); en confirm_order la respuesta se devuelve tras L165-169 sin esperar esas promesas.

**Impacto:** Cuando el pago se confirma vía la Edge Function confirm_order, los inserts en notifications (confirmación al pagador e 'invited_by_player' a cada invitado) no se esperan. Si el worker termina antes de que acaben, o si fallan, la notificación se pierde sin reintento y solo queda un console.error. El resultado son confirmaciones o invitaciones que a veces no llegan. Además, se hace un insert por cada invitado (N+1 viajes de red) en lugar de uno solo en lote.

**Fix propuesto:** Juntar todas las filas (pagador + invitados con id) en un array y hacer un único `const { error } = await db.from('notifications').insert(rows)`. Si falla, registrarlo sin romper la reserva. Otra opción: que materializeReservation devuelva la promesa (p. ej. `notificationsPromise`) y que confirm_order/index.ts la registre con `EdgeRuntime.waitUntil(notificationsPromise)` antes del `return json({ ok: true })`. Lo ideal a medio plazo es crear las notificaciones dentro de la RPC transaccional o con un trigger AFTER INSERT en reservations, para que no dependan de la vida del worker.

### 56. Filtración de mensajes internos de error al cliente
- **Categoría:** seguridad
- **Ubicación:** `supabase/functions/confirm_order/index.ts:171`

**Evidencia:** return json({ error: 'UNEXPECTED', detail: String((e as Error)?.message ?? e) }, 500);

**Impacto:** Un usuario autenticado que provoque una excepción en la materialización de su propia Order recibe en `detail` el mensaje interno sin sanear. Puede ser un error de Postgres/PostgREST concatenado (REWARD_CONSUME_ERROR: ...), nombres de constraints, tablas o funciones RPC, o el motivo interno de rechazo de una recompensa. Con eso se facilita mapear el esquema y la lógica de negocio para preparar ataques más dirigidos. Como además no hay console.error, el equipo pierde ese mismo detalle en los logs de la Edge Function, justo donde sí haría falta para diagnosticar.

**Fix propuesto:** En el catch, generar un `const requestId = crypto.randomUUID();`, registrar `console.error('[confirm_order]', requestId, e)`, con stack incluido, y devolver solo `json({ error: 'UNEXPECTED', requestId }, 500)`. Si el frontend necesita distinguir errores de dominio esperados (por ejemplo REWARD_UNAVAILABLE), conviene que materializeReservation devuelva `{ code }` estructurados en vez de lanzar, o mantener una lista blanca de prefijos conocidos y exponer solo el código, nunca el mensaje de la base de datos.

### 57. CORS con Access-Control-Allow-Origin '*' en endpoint de confirmación de pagos
- **Categoría:** seguridad
- **Ubicación:** `supabase/functions/confirm_order/index.ts:22`

**Evidencia:** 'Access-Control-Allow-Origin': '*',

**Impacto:** Impacto real limitado: como la autenticación va por el header Authorization Bearer y no por cookies, el comodín '*' no permite CSRF ni que un sitio tercero lea respuestas sin tener ya el JWT. Aun así deja que cualquier origen (por ejemplo, un XSS en otro dominio, una extensión o una página de phishing que haya obtenido el token) llame al endpoint de confirmación de pagos desde el navegador. Además contradice el principio de mínimo privilegio en un endpoint sensible, que con Culqi pasará a confirmar cargos reales. Tampoco declara Access-Control-Allow-Methods ni 'Vary: Origin'.

**Fix propuesto:** Sustituir el objeto estático `cors` por una función `corsHeaders(req)`. Esa función lee una allowlist desde env (ej. `ALLOWED_ORIGINS` = dominio de producción en Vercel más el patrón de previews `https://<proyecto>-*.vercel.app`). Refleja `req.headers.get('Origin')` solo si está en la lista; si no, omite el header. Añadir 'Vary: Origin' y 'Access-Control-Allow-Methods: POST, OPTIONS'. En OPTIONS, devolver 204 con esos headers. Aplicar el mismo cambio a cualquier otra función que comparta el patrón. Eliminar o no desplegar `index-credit-backup.ts`, que duplica la misma configuración.

### 58. Metadatos del proyecto Supabase versionados en supabase/.temp (project-ref, org, pooler-url)
- **Categoría:** seguridad
- **Ubicación:** `supabase/.temp/pooler-url:1`

**Evidencia:** git ls-files incluye supabase/.temp/pooler-url (postgresql://postgres.<ref>@aws-1-us-west-1.pooler.supabase.com:5432/postgres, sin contraseña), supabase/.temp/linked-project.json (ref, name, organization_id, organization_slug) y supabase/.temp/project-ref; .gitignore no excluye supabase/.temp.

**Impacto:** El repositorio expone metadatos de infraestructura innecesarios: organization_id y slug de Supabase, nombre del proyecto, región y host del pooler, usuario de base de datos y las versiones exactas de Postgres, GoTrue, Storage y PostgREST. No incluye credenciales, y el project-ref ya es público por el SDK del cliente. Aun así, un atacante tiene ya el destino exacto y el usuario para probar contraseñas contra el pooler en el puerto 5432, que es accesible desde Internet por defecto. También puede buscar CVE que afecten a esas versiones o preparar un phishing contra la organización. No se puede explotar sin una contraseña de BD débil o filtrada.

**Fix propuesto:** 1) Añadir a .gitignore las líneas `supabase/.temp/` y `supabase/.branches/`. 2) Dejar de versionarlos sin borrarlos del disco con `git rm -r --cached supabase/.temp` y hacer commit. Si se quiere borrar también del historial, usar git filter-repo, aunque no es imprescindible porque no hay secretos. 3) En el dashboard de Supabase, comprobar que la contraseña de la BD es larga y aleatoria; si alguna vez se compartió, rotarla en Project Settings > Database. 4) Activar Network Restrictions en Database Settings para que solo las IP necesarias (CI y administradores) lleguen al pooler y a la conexión directa. 5) Si se usa CI, activar secret scanning o un hook pre-commit (por ejemplo gitleaks) para que no vuelvan a colarse archivos del CLI.

### 59. Copia de respaldo de la Edge Function dentro del directorio desplegable con lógica de seguridad más débil
- **Categoría:** seguridad
- **Ubicación:** `supabase/functions/confirm_order/index-credit-backup.ts:93`

**Evidencia:** const snapshot = order.financial_snapshot; — la copia no tiene el chequeo de HOLD vencido (index.ts L72-73), ni la autorización de invitaciones (index.ts L89-107), ni el saneo de source (index.ts L131-137).

**Impacto:** Es código muerto dentro del directorio de una Edge Function de pagos. Hoy no se ejecuta, porque el entrypoint desplegado es index.ts. Si alguien la restaura, la renombra a index.ts o cambia el entrypoint por error, vuelven tres fallos: se podrían confirmar Orders con el HOLD vencido, se aceptaría un `source` de invitación (organizer_invite/algrass_invite) que manda el cliente sin comprobar quién lo pide, y se saltaría la autorización de host/staff para las invitaciones. Esto podría dar cupos con origen falseado o confirmaciones fuera de la ventana del HOLD. Además tener dos versiones confunde las auditorías y las revisiones.

**Fix propuesto:** Borrar supabase/functions/confirm_order/index-credit-backup.ts, porque la versión anterior ya queda en el historial de git (se puede recuperar con `git show <commit>:supabase/functions/confirm_order/index-credit-backup.ts`). Si de verdad hay que conservarla como referencia, moverla fuera de supabase/functions (por ejemplo a docs/legacy/) y añadir un comentario que diga que no es segura. Para que no se repita, conviene añadir una regla de CI o de lint que rechace archivos *-backup.ts o *.bak dentro de supabase/functions.

### 60. Dependencia supabase-js sin versión fijada en la Edge Function
- **Categoría:** seguridad
- **Ubicación:** `supabase/functions/confirm_order/deno.json:3`

**Evidencia:** "@supabase/supabase-js": "npm:@supabase/supabase-js@2"

**Impacto:** Cada despliegue de la Edge Function confirm_order puede usar una versión menor o de parche distinta de supabase-js sin que nadie la revise. Los builds no son reproducibles y puede entrar una regresión o un paquete comprometido en una función que trabaja con la SUPABASE_SERVICE_ROLE_KEY, que salta RLS. Hoy el riesgo es bajo, porque haría falta comprometer el paquete o el registro npm, pero si ocurriera el impacto sería alto, ya que esa clave da acceso total a la base de datos.

**Fix propuesto:** Fijar en deno.json una versión exacta y ya probada, por ejemplo "npm:@supabase/supabase-js@2.45.4" (u otra concreta que se haya validado). Generar el deno.lock (`deno cache --lock=deno.lock --lock-write index.ts`, o `deno install` en Deno 2) y subirlo al repo. Desplegar con verificación del lock (`--frozen` o `"lock": {"frozen": true}` en deno.json). Actualizar la dependencia solo con cambios explícitos y revisados (Dependabot/Renovate). También conviene sacar index-credit-backup.ts del directorio de la función para que no se despliegue código de respaldo.

### 61. Cliente service-role creado en cada petición y consultas secuenciales evitables
- **Categoría:** eficiencia
- **Ubicación:** `supabase/functions/confirm_order/index.ts:43`

**Evidencia:** const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, ...) dentro del handler; L56-57 select('*') sobre orders; L90-100 dos consultas secuenciales (games y user_roles) en el camino de invitación.

**Impacto:** El impacto es marginal. Crear el cliente service-role en cada invocación cuesta CPU/memoria pero no hace ningún round-trip. `select('*')` trae columnas que no se usan, aunque es una sola fila. La consulta extra a `user_roles` solo se hace en invitaciones creadas por alguien que no es el host. Nada de esto pesa en la latencia frente a `getUser` y `materializeReservation`.

**Fix propuesto:** Crear el cliente admin una sola vez a nivel de módulo (fuera de `Deno.serve`) y reutilizarlo entre peticiones del mismo worker. Es seguro porque es stateless con `persistSession: false`.

Cambiar `select('*')` por las columnas que se usan: `id, status, payer_user_id, resource_id, payment_provider, pending_expires_at, financial_snapshot`.

Mantener el cortocircuito host -> staff y no usar `Promise.all`. Si se quiere eliminar un round-trip en el caso staff, la autorización de invitación se puede resolver en una sola consulta/RPC (por ejemplo, `is_invite_authorized(game_id, user_id)`) que compruebe host o rol en una única ida y vuelta.

### 62. Gate de acceso privado basado solo en un flag de localStorage
- **Categoría:** seguridad
- **Ubicación:** `src/lib/privateAccess.js:18`, `src/components/PrivateAccessGate.jsx:29`
- **Detectado por 2 auditores independientes**

**Evidencia:** export function hasPrivateAccess() { try { return localStorage.getItem(PRIVATE_ACCESS_KEY) === PRIVATE_ACCESS_VERSION; } ... } con PRIVATE_ACCESS_KEY = 'algr_private_access' y PRIVATE_ACCESS_VERSION = '2' en el propio bundle.

**Impacto:** Cualquier visitante puede saltarse la pantalla de contraseña de prelanzamiento con una línea en la consola (localStorage.setItem('algr_private_access','2')) y usar toda la app: registrarse, ver el catálogo de partidos y canchas e iniciar flujos de reserva antes del lanzamiento. La contraseña del gate no aporta ninguna confidencialidad real, porque el contenido y los datos solo los protegen el bundle público y las políticas RLS. El riesgo es sobre todo de negocio y de exposición prematura, no una fuga de datos, salvo que el equipo confíe en el gate para ocultar información que las RLS dejan leer a anon.

**Fix propuesto:** Hay dos opciones según lo que deba proteger el gate. (a) Si debe ser una barrera real antes del lanzamiento, moverla al borde activando Vercel Password Protection / Deployment Protection, o un middleware de Vercel (middleware.ts) que valide una cookie HttpOnly firmada que emite una función serverless tras comprobar la contraseña. Así ni el bundle ni las rutas se sirven sin autenticar. Si además hay que bloquear el backend, que check_private_access o una Edge Function marque app_metadata.private_access=true en el usuario (con service role) y que las políticas RLS de las tablas sensibles exijan (auth.jwt()->'app_metadata'->>'private_access')='true'. (b) Si es solo cosmético, documentarlo así en privateAccess.js y revisar que ninguna tabla o RPC dependa del gate para ocultar datos: todo lo que no deba ver un usuario anon debe quedar bloqueado por RLS.

_Hallazgos relacionados que se fusionaron aquí:_ PrivateAccessGate es un control solo de cliente: se omite escribiendo una clave en localStorage

### 63. Inyección de filtros PostgREST en searchUsers a través de .or() sin escapar
- **Categoría:** seguridad
- **Ubicación:** `src/services/reservationService.js:203`

**Evidencia:** .or(`full_name.ilike.%${qDb}%,user_code.ilike.%${qDb}%`) — qDb es la entrada del usuario solo normalizada (deaccent + lowercase); comas, paréntesis y puntos no se escapan.

**Impacto:** No hay escalada real. Cualquier usuario autenticado ya puede consultar users_public directamente vía PostgREST con filtros arbitrarios (sexo, edad, ciudad) usando su propio JWT. Por eso la inyección en .or() no expone nada nuevo. El efecto práctico es funcional: si la búsqueda contiene ',', '(', ')' o una secuencia como 'x.eq.y', la consulta falla con 400 o filtra mal, y la búsqueda de jugadores devuelve vacío sin avisar. La exposición de edad y sexo de perfiles privados existe, pero su origen está en migrations/users_public_view.sql:17-19 (vista DEFINER que publica sex/age sin aplicar profile_private). Conviene reportarla como hallazgo aparte, de severidad media.

**Fix propuesto:** 1) En searchUsers, sanear la entrada antes de interpolarla: `const safe = qDb.replace(/[,()%*\\:"]/g, ' ').trim(); if (!safe) return [];` y usar comillas dobles en el patrón: `.or(`full_name_search.ilike."%${safe}%",user_code.ilike."%${safe}%"`)`. Con full_name_search además se aprovecha la columna ya normalizada. Otra opción es mover la búsqueda a una RPC `search_users(p_query text, p_limit int)` con un ILIKE parametrizado y un límite máximo en el servidor. 2) Quitar el console.debug y el log de error completo de producción (l.206-207). 3) Corregir la causa real en la vista: `CASE WHEN profile_private THEN NULL ELSE sex END AS sex` y lo mismo para age. Así profile_private se aplica en el servidor y no solo en el frontend.

### 64. Visibilidad de partidos solo para capitanes filtrada en el cliente
- **Categoría:** seguridad
- **Ubicación:** `src/services/gameService.js:151`

**Evidencia:** if (!isCaptain) q = q.or('status.eq.reserved,published_audience.eq.public'); — isCaptain es un parámetro del llamador (useGlobalRoles, con caché en localStorage pichanga_global_roles_<uid>, src/hooks/useGlobalRoles.js:15-22).

**Impacto:** La restricción "partido publicado solo para capitanes" se puede saltar del todo. Un usuario normal o anónimo puede listar esos partidos con una consulta REST directa a games (o forzando isCaptain=true o editando la caché de roles en localStorage). Un usuario autenticado puede además reservarlos o pagarlos, porque create_order y las demás RPC de reserva no validan published_audience. Así se anula el beneficio de prioridad para capitanes y captain_gold. No expone datos sensibles ni causa pérdidas económicas directas.

**Fix propuesto:** 1) Aplicar la regla en el servidor. La opción más simple es añadir, en las RPC de reserva (create_order y las variantes de rental, gateway y credit), después de assert_game_reservable: `if exists (select 1 from games where id = v_id and status = 'published' and published_audience = 'captain') and not exists (select 1 from user_roles where user_id = auth.uid() and role in ('captain','captain_gold')) then raise exception 'AUDIENCE_RESTRICTED'; end if;`. 2) Si también hay que ocultarlos del listado, añadir a la política SELECT de games la condición `status <> 'published' or published_audience = 'public' or exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.role in ('captain','captain_gold'))`, o bien servir el listado desde una vista o RPC SECURITY DEFINER con ese filtro. Antes hay que comprobar que la política no rompa getGameById, los joins de pedidos ni los paneles de admin. 3) Mantener el filtro del cliente (gameService.js:151 y :180) solo como UX.

### 65. Lecturas de saldo con escrituras y round-trips duplicados
- **Categoría:** eficiencia
- **Ubicación:** `src/services/reservationService.js:70`

**Evidencia:** getWalletBalance y getRewardBalance (70-88) hacen cada una getSession + ensureWalletSummary (select y posible insert) + select de una sola columna sobre la misma fila; se llaman juntas en ConfirmReservation.jsx:405-409, ChampionshipJoinCheckout.jsx:168-169 y ChampionshipTeamCheckout.jsx:58-59.

**Impacto:** Al abrir cada checkout se hacen hasta 4 consultas a la base de datos y 2 posibles inserts para leer dos columnas de una sola fila (más 2 llamadas a getSession, que normalmente es local). Si el usuario todavía no tiene fila, las dos llamadas en paralelo intentan insertarla a la vez. Si user_id es único, el segundo insert falla sin avisar (no se revisa el error). Si no lo es, puede quedar una fila duplicada y entonces .single() falla en lecturas posteriores. El efecto es algo más de latencia y carga, no un problema de seguridad.

**Fix propuesto:** Crear en reservationService.js una función getWalletBalances() que obtenga la sesión una vez y haga un solo select('credit_balance, reward_balance').eq('user_id', uid).maybeSingle(). Si no hay fila, debe devolver { credit: 0, reward: 0 } sin escribir nada. Usarla en los tres checkouts en lugar de las dos llamadas sueltas. Además, crear la fila de wallet_summary con un trigger AFTER INSERT en auth.users/profiles (o un upsert con ON CONFLICT DO NOTHING en el RPC de gasto). Así se quita ensureWalletSummary del camino de lectura y desaparece la carrera.

### 66. sendNextDayReminders: job batch ejecutable desde el cliente, sin paginación y con inserts uno a uno
- **Categoría:** eficiencia
- **Ubicación:** `src/services/reservationService.js:878`

**Evidencia:** Lee todos los games de mañana, todos los game_players confirmados y todas las notificaciones previas (890-917) y hace un insert por jugador en bucle (925-949); no tiene ningún llamador en src/.

**Impacto:** Hoy el impacto es nulo porque nadie llama a la función. Probablemente ni siquiera entra en el bundle de producción por el tree-shaking. Si se cablea en el cliente pasan tres cosas: (1) correría con el JWT del usuario que la dispare, así que RLS la bloquearía y solo verías logs de error, o bien, si las políticas son permisivas, cualquier usuario podría generar recordatorios para todos los jugadores; (2) los inserts se lanzan sin esperar ninguno, así que `sent` cuenta como enviados los que fallan; (3) la deduplicación se hace en el cliente sin restricción única, lo que permite duplicados si dos ejecuciones coinciden, y escala con N viajes de red. El mismo patrón de N inserts sin esperar se usa en código activo: cancelInvitedPlayers (línea 806) y notifyVenueChanged (línea 845). Ahí causa latencia, errores silenciosos y notificaciones perdidas sin aviso.

**Fix propuesto:** 1) Quitar sendNextDayReminders de src/services y moverlo al servidor, como función SQL `send_next_day_reminders()` SECURITY DEFINER programada con pg_cron a las 18:00 de Lima (23:00 UTC). Debe hacer un único `INSERT INTO notifications (...) SELECT gp.user_id, gp.game_id, ... FROM game_players gp JOIN games g ON g.id = gp.game_id WHERE g.date_key = (now() AT TIME ZONE 'America/Lima')::date + 1 AND gp.status = 'confirmed' AND gp.created_at < <corte 18:00 Lima> ON CONFLICT DO NOTHING`. Ese ON CONFLICT necesita un índice único parcial `CREATE UNIQUE INDEX ON notifications (recipient_user_id, game_id) WHERE template_key = 'next_day_reminder'`. Con eso la deduplicación es atómica. 2) En notifyVenueChanged (línea 845) y cancelInvitedPlayers (línea 806), sustituir el forEach de inserts sin esperar por un único `await supabase.from('notifications').insert(arrayDeFilas)`, y revisar y registrar el error una sola vez. Mejor aún, generar esas notificaciones dentro de la propia RPC o trigger que cambia el estado, para que vayan en la misma transacción.

### 67. hasAvailableWaitlistSpot descarga todas las filas confirmadas para contarlas en JS
- **Categoría:** eficiencia
- **Ubicación:** `src/services/waitlistService.js:111`

**Evidencia:** supabase.from('game_players').select('game_id').eq('status', 'confirmed').in('game_id', ids) y luego cuenta con un Map (113-114).

**Impacto:** El cliente descarga una fila por jugador confirmado de cada partido en espera solo para contarlas, en cada carga de la app (App.jsx:110). El costo es bajo. El problema más relevante es de consistencia: el cálculo duplica en el cliente la lógica de cupos y no resta las reservas activas (game_slot_reservations), así que no coincide con public_availability. Si RLS limita qué filas de game_players ve el usuario, también puede contar menos confirmados. En ambos casos el badge de waitlist puede avisar de un cupo que en realidad no hay.

**Fix propuesto:** Eliminar la segunda consulta y leer el campo calculado: supabase.from('games').select('id, date_key, time, duration_min, public_availability').in('id', ids). Luego devolver games.some(g => !isGamePast(g.date_key, g.time, g.duration_min) && (g.public_availability ?? 0) > 0). Otra opción es una RPC SECURITY DEFINER has_available_waitlist_spot() que use auth.uid() y devuelva el booleano en una sola llamada.

### 68. El ajuste de privacidad del perfil se muestra como aplicado aunque el UPDATE en servidor falle
- **Categoría:** seguridad
- **Ubicación:** `src/screens/Settings.jsx:621`

**Evidencia:** togglePrivacy() (l.615-626): `setPrivacyOn(v); localStorage.setItem(PRIVACY_KEY, ...)` antes de la escritura, y luego `supabase.from('users').update({ profile_private: !v }).eq('id', user.id).then(({ error }) => console.log('[privacy] update result error =', error));` sin rollback ni aviso. Además l.620 hace console.log del user.id en producción.

**Impacto:** Si el UPDATE falla, el usuario ve el toggle como privado mientras en la base sigue profile_private=false, y otros jugadores siguen viendo su edad y sexo sin que él lo sepa. Como el estado inicial sale de localStorage y no del servidor, en otro dispositivo o tras limpiar el navegador el toggle puede mostrar un valor distinto del real. Los console.log dejan el UUID del usuario en la consola en producción, aunque el impacto de esto es menor.

**Fix propuesto:** Convertir togglePrivacy en async y esperar el resultado: `const { error } = await supabase.from('users').update({ profile_private: !v }).eq('id', user.id);`. Si hay error, revertir setPrivacyOn(!v) y localStorage y mostrar un toast. También vale actualizar solo después de que el servidor confirme. Al montar, leer users.profile_private del servidor (o del perfil ya cargado en el contexto de auth) y usar localStorage solo como caché. Quitar los console.log/console.warn de l.620-624 o envolverlos en `if (import.meta.env.DEV)`. Para que la privacidad sea real, no devolver age/sex de usuarios con profile_private=true a terceros: hacerlo con una vista o RPC que aplique la regla en el servidor, en lugar de filtrar en el cliente (GameDetail.jsx l.519).

### 69. MaintenanceGate falla en abierto y depende solo del cliente
- **Categoría:** seguridad
- **Ubicación:** `src/components/MaintenanceGate.jsx:55`

**Evidencia:** `if (status.error || !status.mode) { setPhase('children'); return; }` y l.72 `const fail = () => { if (alive) setPhase('children'); };`. Basta con bloquear la petición a get_maintenance_status (devtools/extensión) para que la app cargue normalmente.

**Impacto:** Durante el modo mantenimiento, cualquier usuario puede seguir usando la app y escribiendo en la base, ya sea a propósito (bloqueando o modificando la RPC get_maintenance_status, o llamando a la API de Supabase directamente) o sin querer (si la RPC falla, la app se abre por diseño). Así se pueden producir escrituras (pedidos, reservas) mientras se ejecutan migraciones o se atiende un incidente, con riesgo de datos inconsistentes. No da acceso a datos de otros usuarios más allá de lo que ya permiten RLS y las RPC.

**Fix propuesto:** Si el mantenimiento tiene que congelar escrituras, hay que aplicarlo también en el servidor. Propuesta: crear una función SQL `assert_not_maintenance()` (SECURITY DEFINER) que lea app_settings.maintenance_mode y lance una excepción si está activo y el usuario (auth.uid()) no tiene el rol algrass_admin o algrass_staff en user_roles. Llamarla al inicio de las RPC de escritura (create_order, reserve_slots, etc.) y/o añadirla como condición en las políticas RLS de INSERT/UPDATE/DELETE de las tablas críticas. El fail-open del cliente se puede mantener solo como UX, y conviene documentar que no es un control de seguridad.

### 70. La pantalla /email-changed muestra éxito con solo poner type=email_change en la URL
- **Categoría:** seguridad
- **Ubicación:** `src/main.jsx:28`

**Evidencia:** `: (_p.get('type') === 'email_change' || _p.get('access_token')) ? 'success' : 'invalid';` el veredicto se basa en parámetros de la URL que cualquiera puede escribir, sin comprobar con Supabase.

**Impacto:** Cualquiera puede preparar un enlace del dominio legítimo (por ejemplo https://<app>/?type=email_change) que muestra 'Correo actualizado' sin que haya habido ningún cambio. Se puede usar para ingeniería social, por ejemplo junto con un correo de phishing que diga 'hemos cambiado tu correo', o simplemente confunde al usuario sobre el estado de su cuenta. No expone datos ni cambia la cuenta: el único efecto es un mensaje engañoso en la interfaz. Además, si Supabase tiene activado 'secure email change' (doble confirmación) y el primer enlace también lleva type=email_change, el usuario puede ver 'éxito' antes de confirmar el segundo enlace. Este último caso depende de cómo esté configurado el proyecto y no lo he podido comprobar en el código.

**Fix propuesto:** Usar los parámetros de la URL solo como pista y confirmar el éxito con el servidor. En main.jsx, guardar 'pending' en lugar de 'success' cuando haya type=email_change o access_token, y seguir guardando 'error' si llegan error o error_description. En EmailChanged.jsx, cuando el valor sea 'pending', esperar a que el cliente Supabase termine de procesar la URL (onAuthStateChange con INITIAL_SESSION/SIGNED_IN/USER_UPDATED). Después llamar a supabase.auth.getUser() y mostrar éxito solo si hay usuario, user.new_email está vacío (no queda ningún cambio pendiente) y user.email_change_sent_at o user.updated_at son recientes, o el correo coincide con el que se pidió (guardado en localStorage al solicitar el cambio). En cualquier otro caso, mostrar un estado neutro ('Si confirmaste el cambio, verás el nuevo correo en tu perfil'), no un éxito. Corregir también los comentarios de main.jsx:12-16 y EmailChanged.jsx:11-16, que hoy dicen que no hay falso éxito.

### 71. La clave de acceso de campeonato se guarda en texto plano en sessionStorage
- **Categoría:** seguridad
- **Ubicación:** `src/screens/ChampionshipView.jsx:63`

**Evidencia:** `sessionStorage.setItem(keyAccessId(uid, cid), JSON.stringify({ key, expiresAt: Date.now() + KEY_ACCESS_TTL_MS }))` guarda la clave tecleada para revalidarla después.

**Impacto:** La clave de acceso de un campeonato privado queda en texto plano en sessionStorage hasta 15 minutos. Un script inyectado (XSS, una dependencia comprometida o una extensión maliciosa) o alguien con acceso físico a la pestaña abierta puede leerla y compartirla. Así terceros podrían entrar al campeonato privado hasta que el owner cambie la clave. No permite tomar la cuenta ni causa pérdidas económicas.

**Fix propuesto:** No guardar la clave en el cliente. Que verify_championship_access, al validar la clave, registre en el servidor un grant por (user_id, championship_id) con expiración, por ejemplo en una tabla championship_access_grants protegida con RLS. Al volver a entrar, se consulta ese grant con una RPC has_championship_access(p_championship_id) en vez de reenviar la clave. Otra opción es que la RPC devuelva un token opaco firmado y de corta vida, y guardar solo ese token. En ambos casos, writeKeyAccess guardaría como mucho {expiresAt}, sin la clave. Si el owner rota la clave, el servidor invalida los grants.

### 72. Recarga duplicada de la competición al volver a la pestaña
- **Categoría:** eficiencia
- **Ubicación:** `src/screens/ChampionshipView.jsx:960`
- **Detectado por 2 auditores independientes**

**Evidencia:** `window.addEventListener('focus', refetch); document.addEventListener('visibilitychange', refetch);` ambos llaman loadCompetition(); además App.jsx:70 emite 'app-foreground' en el mismo evento.

**Impacto:** Cada vez que el usuario vuelve a la pestaña o a la app (por ejemplo, en una PWA en el móvil), se hacen dos llamadas casi simultáneas a la RPC get_championship_competition, que es pesada porque devuelve partidos, clasificación y goleadores. Así se duplica la carga de Supabase y el tráfico de datos en ese momento, y hay un setCompetition de más. Si la respuesta más antigua llega después, puede quedar pintada brevemente. App.jsx emite 'app-foreground', pero esta pantalla no lo escucha, así que no hay tercera llamada.

**Fix propuesto:** Hay que quitar los dos listeners locales y usar la señal global que ya existe. Se añade `const fgTick = useForegroundTick();` y fgTick entra en las dependencias del useEffect de carga de la línea 956, o un effect propio llama a loadCompetition() cuando cambia fgTick. Si se quiere mantener el refetch en 'focus' (por ejemplo, al volver de ChampionshipTeam dentro de la SPA), conviene dejar un solo evento y deduplicar con una referencia. Primero, `const inflight = useRef(false); const lastAt = useRef(0);`. Después, en loadCompetition: `if (inflight.current || Date.now() - lastAt.current < 2000) return; inflight.current = true; lastAt.current = Date.now(); getChampionshipCompetition(...).then(...).finally(() => { inflight.current = false; });`. Además, se puede ignorar una respuesta obsoleta con un contador de petición (reqId).

_Hallazgos relacionados que se fusionaron aquí:_ Al volver a la app se repiten los refetch: 'focus' y 'visibilitychange' disparan la misma carga dos veces, además de app-foreground

### 73. El mapa destruye y recrea todos los marcadores ante cualquier cambio
- **Categoría:** eficiencia
- **Ubicación:** `src/screens/MapView.jsx:82`
- **Detectado por 2 auditores independientes**

**Evidencia:** El efecto con deps `[venues, games, selectedVenueId, selectedDistricts]` hace `markersRef.current.forEach(m => m.remove()); markersRef.current.clear();` y vuelve a crear un L.marker con L.divIcon HTML por venue.

**Impacto:** Cada vez que se selecciona un venue o cambia la fecha o el filtro de distritos, se eliminan y se vuelven a crear todos los marcadores. Cada uno lleva un divIcon con img, badge, filtros CSS y drop-shadow, y se registra de nuevo su listener. Con pocas decenas de venues el coste es menor. Aun así hay trabajo de DOM innecesario: cambiar la selección solo afecta a 2 marcadores, pero se rehacen todos. Además, la transición CSS de escala (transition:transform .12s) nunca se ve, porque el nodo se reemplaza en lugar de actualizarse. Con muchos venues podría dar algo de jank en móviles de gama baja.

**Fix propuesto:** Separar el efecto en dos. (1) Uno con deps [venues] que cree o elimine los marcadores de forma incremental. Debe quitar solo los venues que ya no existen y añadir los nuevos, guardando el marcador en markersRef por v.id, y registrar el click una sola vez usando onSelectRef. (2) Otro con deps [games, selectedVenueId, selectedDistricts] que calcule los counts y, por cada marcador, llame a marker.setIcon(markerIcon(count, selected, dimmed)) solo si cambió el trío (count, selected, dimmed). Para saberlo, guardar la última clave en un Map (por ejemplo `${count}|${selected}|${dimmed}`). Otra opción, para conservar la animación de escala: mantener el mismo divIcon y modificar el estilo y el texto del badge directamente en marker.getElement(). En los padres no hace falta memoizar nada más: games y selectedDistricts ya son referencias estables.

_Hallazgos relacionados que se fusionaron aquí:_ MapView destruye y recrea todos los marcadores Leaflet cada vez que cambia la selección

### 74. El sondeo del estado de la orden no tiene límite para métodos de pago distintos de crédito (1 petición por segundo)
- **Categoría:** eficiencia
- **Ubicación:** `src/screens/ConfirmReservation.jsx:994`

**Evidencia:** `if (isCredit && Date.now() - t0 >= DEADLINE) { finalReconcile(); return; }` seguido de `pollTimerRef.current = setTimeout(pollStatus, 1000);` (L994-995). En L1050, `pollStatus()` se llama ante cualquier error no clasificado de confirm_order, sea cual sea el método de pago.

**Impacto:** Con métodos distintos de crédito (Yape/tarjeta), si confirm_order devuelve un error no clasificado y la orden sigue en `pending`, el overlay consulta `getOrderStatus` cada segundo hasta que el cron expire la orden (TTL del hold de 10 min). Son hasta ~600 lecturas por checkout atascado. Durante ese tiempo el usuario no recibe un resultado final y el móvil gasta más batería y datos. Impacto acotado: solo ocurre en una ruta de error poco común y se detiene al desmontar o al expirar la orden.

**Fix propuesto:** Aplicar también un DEADLINE a los métodos que no son crédito, por ejemplo 60 s (`if (Date.now() - t0 >= (isCredit ? DEADLINE : DEADLINE_EXTERNAL)) { finalReconcile(); return; }`). Al vencer, `finalReconcile()` mostraría el copy neutral recuperable ('CONFIRM_UNCERTAIN'/'CONFIRM_UNRESOLVED'), redactado para pagos externos sin afirmar que no hubo cobro. Sustituir el intervalo fijo de 1 s por backoff exponencial con tope (1s, 2s, 4s… máx. 10s), por ejemplo con un contador de intentos. Opcional: usar una suscripción Supabase Realtime a la fila de `orders` (filtrada por id) en lugar del polling.

### 75. El handler de scroll del feed lee el layout de todos los headers en cada evento y re-renderiza la lista completa
- **Categoría:** eficiencia
- **Ubicación:** `src/screens/PickupGames.jsx:1441`

**Evidencia:** `onListScroll` (L1441-1458) recorre `grouped` y llama a `el.getBoundingClientRect()` por cada header de fecha en cada evento scroll, sin throttle ni rAF. Al cambiar de sección hace `setSelectedKey(currentKey)`, que re-renderiza PickupGames y todas las `GameRow` (no memoizadas, y reciben objetos nuevos como `guestInfo={{...}}` en L1466). Fields.jsx L920 repite el patrón.

**Impacto:** Cada evento de scroll del feed (PickupGames y Fields) lee el layout de los headers de fecha de forma síncrona. Cada vez que cambia el día visible se re-renderizan todas las `GameRow`/filas, porque no están memoizadas y reciben objetos nuevos (`guestInfo`). En móviles de gama baja con muchas filas puede haber algún frame perdido justo al cruzar de un día a otro. No hay layout thrashing (no se escribe en el DOM entre lecturas) y el re-render no ocurre en cada frame, así que el impacto en el rendimiento es pequeño.

**Fix propuesto:** Cambiar la detección del día visible por un IntersectionObserver sobre `headerRefs.current[key]`, con `root: listRef.current` y un `rootMargin` como '0px 0px -95% 0px'. Así se eliminan las lecturas de layout en el handler de scroll, que solo actualizaría `listScrollPosRef`. Otra opción mínima es agrupar el cálculo con `requestAnimationFrame`, guardando un flag `ticking` en un ref. Además, envolver `GameRow` en `React.memo` y pasarle props primitivas: por ejemplo, pasar `st` (estable desde `gameStateMap`) o los campos sueltos en lugar del objeto literal `guestInfo={{...}}`, o construirlo con `useMemo`. Aplicar lo mismo a src/screens/Fields.jsx L920 y a su componente de fila.

### 76. Las notificaciones a invitados se insertan una a una en un forEach en lugar de un insert masivo
- **Categoría:** eficiencia
- **Ubicación:** `src/screens/ConfirmReservation.jsx:1219`

**Evidencia:** `guests.filter(g => g.id).forEach(guest => { supabase?.from('notifications').insert({ recipient_user_id: guest.id, ... }) })` (L1219). El mismo patrón aparece en L1089 (rama invitedMode).

**Impacto:** Al confirmar una reserva con invitados, el cliente lanza una petición HTTP por cada invitado (L1089-1101 y L1219-1231), además de la notificación propia. Las peticiones salen en paralelo y no se esperan, así que la latencia que percibe el usuario apenas cambia. Aun así, se multiplican las peticiones a Supabase y las evaluaciones de RLS. Además, puede haber fallos parciales: unos invitados reciben la notificación y otros no, y el error solo queda en console.error. Si el usuario cierra o navega antes de que terminen las promesas, algunas inserciones pueden perderse.

**Fix propuesto:** Hacer un único insert masivo en ambas ramas: `const rows = guests.filter(g => g.id).map(guest => ({ recipient_user_id: guest.id, source_type: 'venue', delivery_type: 'automatic', category: 'invitation', template_key: 'invited_by_player', custom_text: ..., game_id: gameId, venue_id: game?.venueId ?? null, reservation_id: reservationId, created_by: authUser?.id, sent_at: new Date().toISOString() })); if (rows.length) supabase?.from('notifications').insert(rows).then(({ error }) => { if (error) console.error(...) });`. Así la operación es atómica: todas las notificaciones se insertan o ninguna. Lo ideal es generarlas en el servidor, con un trigger sobre la tabla de invitados de la reserva o dentro de la RPC de confirmación, para no depender del cliente.

### 77. ChampionshipView parsea JSON de sessionStorage en cada render de un componente de unas 2.500 líneas
- **Categoría:** eficiencia
- **Ubicación:** `src/screens/ChampionshipView.jsx:120`

**Evidencia:** `const persisted = readCV();` (L120) en el cuerpo del componente, donde `readCV = () => JSON.parse(sessionStorage.getItem(CV_KEY))` (L47). El componente ChampionshipView va de L95 a L2597 y tiene decenas de useState (por ejemplo `flashToast` en L656 hace dos setState que re-renderizan todo). Lo mismo pasa en Profile.jsx L2381 (`_readPFCache`), L2393 (`_hostedCache`, IIFE con JSON.parse de localStorage) y L2916 (`_champCv`).

**Impacto:** Cada render de ChampionshipView (L95-L2585) y de Profile hace en el hilo principal lecturas síncronas de Web Storage y JSON.parse de blobs que pueden contener el campeonato entero (equipos, fixture, realRow, regState) o rosters y partidos cacheados. Pasa también con renders triviales como toasts, escritura en inputs o ticks. No rompe nada funcionalmente, pero añade trabajo de CPU en cada render a componentes enormes que ya re-renderizan mucho, y se nota en móviles de gama baja cuando el JSON es grande.

**Fix propuesto:** En ChampionshipView, leer el blob una sola vez al montar con `const [persisted] = useState(readCV);` o `const persistedRef = useRef(); if (persistedRef.current === undefined) persistedRef.current = readCV();`. Así quedan cubiertos restore y cachedReal (L126-L130), que solo sirven de estado inicial. Para los usos de modo mock en L231/232/237/284, que dependen de nav o de lo escrito por writeCV, hay dos opciones: confirmar que con el snapshot del montaje basta, porque writeChamp ya sincroniza el estado `champ`, o leer de un estado/ref que se actualice junto con writeCV, en lugar de volver a parsear sessionStorage en cada render. En Profile.jsx, cambiar `_pf0` (L2381) y `_hostedCache` (L2393) por `useMemo(() => ..., [user?.id])` o inicializadores lazy de useState (`useState(() => _readPFCache(user?.id)?.rows ?? [])`), y `_champCv` (L2916) por `useMemo(() => {try{return JSON.parse(sessionStorage.getItem('championship_view_state'))}catch{return null}}, [])` o un refresco explícito al volver a la vista. A medio plazo, dividir ChampionshipView en subcomponentes (gate de acceso, inscripciones, resultados, toast) para que un toast no re-renderice todo el árbol.

### 78. Perfil recalcula sin memoizar las listas derivadas (matchCards, allGames, upcoming, past) en cada render
- **Categoría:** eficiencia
- **Ubicación:** `src/screens/Profile.jsx:2777`

**Evidencia:** `const matchFinancialMap = new Map(...)` (L2777), `buildCaptainSlotsMap` y `deriveMatchCards(...).map(...)`, `const allGames = (() => {...})()` (L2793) y `const upcoming = sortByDt(temporalGames.filter(...))` / `past` (L2889-2890) se calculan en el cuerpo del componente. En todo el archivo solo hay un useMemo (L2765).

**Impacto:** Cada setState de Perfil (modales, highlight con timeout de 4.5 s, cada fetch de la ráfaga inicial, expandir o colapsar) vuelve a filtrar, mapear, deduplicar y ordenar todas las listas de partidos, y crea objetos nuevos. Además, todas las GameRow se re-renderizan siempre. Con pocos partidos el costo por render es pequeño, pero se multiplica por la cantidad de renders y puede notarse como trabajo extra en móviles de gama baja durante la carga y las animaciones. No tiene impacto de seguridad.

**Fix propuesto:** Envolver la cadena derivada en useMemo: matchCards con deps [myPlayerRows, payerNames, user?.id, extraGames, captainR1Rows], activeRentalCards con [rentalCards], allGames/temporalGames con [matchCards, activeRentalCards, waitlistEntries, hostedGameRows, dataReady, myPlayerRowsReady, extraGames, rentalCards], y upcoming/past con [temporalGames]. Ojo: isPast/isStarted dependen de la hora actual, así que conviene agregar un tick de reloj como dep si se necesita reclasificar en vivo. Exportar GameRow como React.memo(GameRow). Pasar un onPress estable (openGameDetail envuelto en useCallback, y que GameRow llame onPress(game)) en lugar de la arrow inline de L3555/L3599, porque si no React.memo no tiene efecto.

### 79. PlayerModal hace 4 consultas cuando 2 bastarían (game_players confirmado se consulta dos veces)
- **Categoría:** eficiencia
- **Ubicación:** `src/screens/GameDetail.jsx:528`

**Evidencia:** L527-533: `game_players ... .eq('user_id', ...).eq('status','confirmed').limit(1)` para isVerified; L542-547: `game_players.select('id', { count: 'exact', head: true }).eq('user_id', ...).eq('status','confirmed')` para gamesPlayed (mismo filtro). También hay una consulta extra a reservations (L535-540).

**Impacto:** Cada vez que se abre la ficha de un jugador salen 4 peticiones a Supabase en paralelo. Una de ellas (game_players confirmado con limit 1, L528-534) repite el filtro de la consulta con count (L544-549), y la de reservations (L536-542) se lanza aunque ya se sepa que el jugador está verificado. El efecto es algo más de tráfico y carga en PostgREST/RLS al revisar varios perfiles. No afecta a la seguridad ni se nota en la latencia, porque las peticiones son paralelas.

**Fix propuesto:** Eliminar la consulta de L528-534 y en la consulta con count (L544-549) hacer `.then(({ count }) => { if (count != null) { setGamesPlayed(count); if (count > 0) setVerified(true); else /* consultar reservations status='spend' limit(1) */ } })`, para que la consulta a reservations solo se lance cuando count === 0. Otra opción es crear una RPC o vista `player_public_stats(user_id)` (SECURITY INVOKER, o DEFINER con las columnas públicas limitadas) que devuelva games_played y verified (EXISTS en game_players o reservations) en una sola llamada. Junto con la de users_public quedarían 2 peticiones por ficha.

### 80. La pantalla de Intro y su QR PNG de 100 KB se cargan de forma estática aunque solo se usan en la primera visita
- **Categoría:** eficiencia
- **Ubicación:** `src/screens/IntroScreen.jsx:4`, `src/screens/IntroScreen.jsx:181`
- **Detectado por 2 auditores independientes**

**Evidencia:** `import IntroScreen from './screens/IntroScreen';` (L8) es import estático, mientras el resto de pantallas usan `lazy()` (L138-161). IntroScreen.jsx L4 importa `../assets/algrass-qr.png` (99.674 bytes), que se muestra a 180x180 (L181). vite.config.js precachea `**/*.{js,css,html,svg,png,woff2}`, así que el PNG entra en el precache del Service Worker.

**Impacto:** Cada instalación o actualización del Service Worker descarga y guarda en el precache unos 100 KB de un QR (602x598 RGBA) que se muestra a 180x180 y que se podría resolver con 1-3 KB. Esto penaliza sobre todo a usuarios móviles con datos limitados y a cada deploy que invalide el precache. Mantener IntroScreen con import estático añade unos 12 KB de código fuente al chunk principal para usuarios recurrentes con acceso privado. Pero mientras PRIVATE_MODE=true, el Intro es la landing pública de '/', así que ese coste está justificado en parte.

**Fix propuesto:** 1) Reemplazar `src/assets/algrass-qr.png` por un SVG del QR (pocos KB, nítido a cualquier tamaño). Otra opción es reexportarlo como PNG de 1 bit / paleta indexada a 360x360 (unos 2 KB) con `pngquant`/`oxipng`. 2) En vite.config.js, añadir `globIgnores: ['**/videos/**', '**/*.mp4', '**/algrass-qr*']`, o restringir `globPatterns` para no precachear imágenes de onboarding. 3) Opcional: cuando PRIVATE_MODE pase a false, cargar IntroScreen con `lazy(() => import('./screens/IntroScreen'))` dentro de un `<Suspense>` en src/App.jsx L8/L218/L276, o precargarlo con `import()` solo si `!localStorage.getItem(INTRO_KEY)`. Mientras el Intro sea la landing pública, mantener el import estático evita una cascada de peticiones en el primer pintado.

_Hallazgos relacionados que se fusionaron aquí:_ Assets sobredimensionados: QR de 602x598 PNG (100 KB) mostrado a 180px, icono PWA 512 de 260 KB, video intro de 697 KB

### 81. react-router 7.14.2 con vulnerabilidades conocidas (npm audit: 3 high)
- **Categoría:** seguridad
- **Ubicación:** `package.json:22`

**Evidencia:** `"react-router-dom": "^7.14.2"`; package-lock.json:5753 resuelve react-router 7.14.2. `npm audit --omit=dev`: GHSA-wrjc-x8rr-h8h6 (open redirect vía backslash en <Link>/useNavigate, <7.18.0), DoS por route matching ineficiente (<7.18.0), varias de SSR/RSC; además `ws` 8.20.0 (package-lock.json:7293, dependencia de @supabase/realtime-js) con DoS por fragmentos (<8.21.0).

**Impacto:** Hoy no veo un vector explotable. El proyecto es una SPA sin SSR ni RSC y ningún destino de navigate() o <Link> sale de la URL, así que los avisos de react-router no aplican, open redirect incluido. ws no se ejecuta en el navegador. El riesgo es latente: si mañana alguien navega a un destino tomado de un query param (por ejemplo ?next=), el open redirect con backslash (GHSA-wrjc-x8rr-h8h6) se podría usar para phishing tras el login. Además, `npm audit` marca 2 paquetes high, lo que bloquea auditorías y compliance.

**Fix propuesto:** Subir a `react-router-dom@^7.18.2` en package.json:22, que cubre todos los avisos (el último corregido en 7.18.2). Regenerar el lockfile actualizando también @supabase/supabase-js para que ws (dependencia de realtime-js) llegue a >=8.21.0; si no basta, forzarlo con `"overrides": { "ws": "^8.21.0" }`. Añadir `npm audit --omit=dev --audit-level=high` al CI. Como defensa extra, si algún día se navega a un destino tomado de la URL, aceptar solo rutas que empiecen por '/' y no contengan '//' ni '\\'.

### 82. Dos hojas de Google Fonts bloqueantes en <head>, una marcada como TEMP para un test
- **Categoría:** eficiencia
- **Ubicación:** `index.html:16`

**Evidencia:** L13 `<!-- TEMP: Inter para test tipográfico del intro desktop ... -->`, L16 `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" />`, L18 Familjen Grotesk + Public Sans usadas solo en ChampionshipIntroContent.css (pantalla lazy).

**Impacto:** En cada arranque en frío y en todas las rutas, el primer pintado espera a 2 hojas CSS de fonts.googleapis.com (DNS+TLS a otro dominio, más acusado en móvil con red lenta), aunque Familjen Grotesk y Public Sans solo se usan en la pantalla lazy de Campeonatos. Los woff2 solo se descargan cuando se usan, así que el coste se limita sobre todo a las CSS bloqueantes. Como las fuentes no se precachean, en la PWA offline la intro y Campeonatos caen a fuentes del sistema. También queda en producción un comentario "TEMP" de un test tipográfico que ya no se sabe si sigue vigente.

**Fix propuesto:** 1) Decidir si el test de Inter terminó. Si se descarta, quitar index.html L13-16 y el 'Inter' de IntroScreen.jsx:130. Si se queda, autoalojarla (p.ej. @fontsource/inter, solo los pesos que se usan) e importarla desde IntroScreen, y borrar el comentario TEMP. 2) Quitar index.html L18 e importar Familjen Grotesk y Public Sans autoalojadas (p.ej. @fontsource/familjen-grotesk/600.css y 700.css, @fontsource/public-sans/400.css, 500.css y 600.css) desde ChampionshipIntro.jsx o ChampionshipIntroContent.css, para que vayan con el chunk lazy y entren en el precache de Workbox (woff2 ya está en globPatterns). 3) Si se mantiene Google Fonts, al menos no bloquear el render: usar rel="preload" as="style" con onload que lo cambie a stylesheet, más un <noscript> de respaldo, y quitar los preconnect cuando ya no se usen.

### 83. .env commiteado y no ignorado; .gitignore solo cubre *.local
- **Categoría:** seguridad
- **Ubicación:** `.gitignore:13`

**Evidencia:** .gitignore L13 `*.local` es la única regla de entornos; `.env` está trackeado (git ls-files) con VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY. .env.example ya existe con placeholders.

**Impacto:** Hoy no se expone nada sensible: la URL y la anon key de Supabase ya son públicas porque van en el bundle de Vite. El riesgo está en que `.env` no está ignorado. Si alguien añade ahí un secreto de servidor (SUPABASE_SERVICE_ROLE_KEY, claves de Culqi o Resend para probar Edge Functions en local), un simple `git add -A` lo sube al repositorio y queda para siempre en el historial. Una service_role filtrada se salta todo el RLS.

**Fix propuesto:** 1. Ejecutar `git rm --cached .env` para dejar de seguir el archivo sin borrarlo del disco.
2. Añadir a .gitignore estas reglas:
```
.env
.env.*
!.env.example
```
3. Definir VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en las variables de entorno de Vercel.
4. Guardar los secretos de las Edge Functions solo con `supabase secrets set`.
5. Añadir gitleaks como hook de pre-commit o paso de CI para bloquear secretos que se cuelen en el futuro.

### 84. .claude/settings.local.json commiteado con anon keys de dos proyectos Supabase y rutas locales
- **Categoría:** seguridad
- **Ubicación:** `.claude/settings.local.json:22`

**Evidencia:** L22-23 y L41-43 contienen comandos curl completos con apikey/Bearer JWT anon de dos proyectos (refs nubag... e iwgh...), más rutas locales `C:\Claude Code\AlGrass` y permisos amplios como `Bash(git push *)`, `Bash(npx supabase *)`.

**Impacto:** Se expone el ref y la anon key de un segundo proyecto Supabase (nubag..., posiblemente antiguo o de staging). Las peticiones de las líneas 22-23 consultan su tabla reservations. Si ese proyecto sigue activo con un RLS débil, cualquiera que tenga acceso al repo podría leer o escribir sus datos con el rol anon. También se publican las rutas locales y la lista de permisos personales del agente (git push *, npx supabase *). Quien clone el repo y use Claude Code hereda esos permisos amplios sin que se le pidan.

**Fix propuesto:** Ejecutar `git rm --cached .claude/settings.local.json` y añadir `.claude/settings.local.json` a .gitignore, porque es un archivo local por diseño. Si hace falta compartir permisos, moverlos a .claude/settings.json sin claves ni rutas absolutas. Para el proyecto nubagkhrkheehvxoieku: si ya no se usa, pausarlo o eliminarlo; si sigue activo, auditar el RLS de reservations y del resto de tablas, o rotar su JWT secret. Al rotarlo se invalida la anon key filtrada, que seguirá en el historial de git.

## Hallazgos refutados en la verificación
- **Invitaciones gratuitas (reservation_type 'invited') creadas desde el cliente sin verificar que el actor sea host/staff** (`src/services/reservationService.js`): La línea existe: createInvitedReservation está en reservationService.js:371 e inserta en el cliente una reserva con total 0 y source 'organizer_invite'. Lo que no se sostiene es el argumento del hallazgo. En v23 la UI ya no usa ese camino. En ConfirmReservation.jsx:728-731, handleConfirm, con invitedMode activo, llama a payWithCredit('invited'). Esa función (líneas 893-918) pasa por create_order y…
- **confirmed_email escrito desde el cliente (verificación de correo falsificable)** (`src/screens/Profile.jsx`): Las líneas citadas existen en v23 (AuthContext.jsx:73 y :123, Profile.jsx:3320), y la política users_update_own (full.sql:590) junto con GRANT ALL ON public.users TO authenticated/anon (full.sql:863-864) sí permiten al dueño de la fila escribir cualquier columna. Pero lo que afirma el hallazgo, que la verificación de correo se puede falsificar, no se sostiene. confirmed_email no es una verificació…
- **Código de diagnóstico con select('*') sin límite y helper de pruebas en el bundle de producción** (`src/services/gameService.js`): Verificado en v23: `testConnection` (gameService.js:16-18) y `fetchFreeRentalBlock` (championshipService.js:110-132) existen pero no se importan en ningún sitio; Vite los elimina por tree-shaking y nunca se ejecutan. Es código muerto (higiene), sin impacto real de seguridad ni eficiencia. Recomendación menor: borrarlos…
- **Búsqueda de usuarios interpola la entrada del usuario dentro del filtro .or() de PostgREST** (`src/services/reservationService.js`): La línea existe en v23: `.or(`full_name.ilike.%${qDb}%,user_code.ilike.%${qDb}%`)` (l.203), y el console.debug está en l.207. Pero la "inyección" no da ningún privilegio. La consulta se construye en el navegador del propio atacante contra PostgREST con la clave anon pública. migrations/users_public_view.sql:40 concede `GRANT SELECT ON public.users_public TO authenticated`, así que cualquier usuari…
