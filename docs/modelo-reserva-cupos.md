# Modelo funcional — Reserva de cupos (CONGELADO)

Estado: **congelado** antes de tocar el backend. Este documento manda sobre los
comentarios de las migraciones cuando haya discrepancia.

## 1. Dos campos, dos conceptos

La pertenencia y el consumo son **cosas distintas** y viven en campos distintos de
`game_players`:

| Campo | Qué representa | No representa |
|---|---|---|
| `game_slot_reservation_id` | **Pertenencia al grupo** del capitán. Pegajoso: se conserva en cancelación y reingreso. | El consumo. |
| `counts_reserved_slot` | **"Este jugador cuenta dentro del contador de cupos reservados."** | La pertenencia. |

`counts_reserved_slot` es el nombre definitivo (antes tentativo `uses_reserved_slot`).
Un jugador puede pertenecer a un grupo (`game_slot_reservation_id` no nulo) y **no**
contar (`counts_reserved_slot = false`): p. ej. el séquito inicial. Un jugador
cancelado también deja de contabilizar, pero por `status = 'canceled'`, no por
forzar el booleano (ver §5).

## 2. `reserved_slots_used` — redefinición (mantenimiento abierto)

`reserved_slots_used` pasa a representar:

> el número de jugadores `status = 'confirmed'` cuyo `counts_reserved_slot = true`.

**La forma de mantener ese valor queda ABIERTA** (COUNT dinámico vs. columna
almacenada sincronizada). Se decide después. Este documento solo fija su
*significado*, no su *implementación*.

Derivados que NO cambian de fórmula:

- `reserved_slots_remaining = MAX(reserved_slots_total − reserved_slots_used, 0)`
- Capacidad pública:
  - con reserva **ACTIVE**: `total_spots − confirmados − reserved_slots_remaining`
  - sin reserva **ACTIVE**: `total_spots − confirmados`

Solo `status = 'active'` retiene cupos (aporta `remaining` al *held*).

## 3. `carriedGroup(actor)` — SIN CAMBIOS

La definición **no cambia**. Sigue resolviendo, en orden:

1. **Liderazgo** — la reserva que el actor lidera actualmente para ese partido
   (paso 1, **se mantiene**). → su id.
2. **Pertenencia** — si no lidera, el `game_slot_reservation_id` de su fila
   `confirmed` en el partido. → ese id (o NULL).
3. NULL.

Lo único que cambia en todo el modelo respecto de la reutilización de reservas está
en la sección 4. El paso 1 **no desaparece**.

## 4. Única diferencia real: no existe R2

- Existe **una sola reserva reutilizable** por (capitán, partido).
- **Nunca** se crea una R2 mientras exista esa reserva.
- Cuando el capitán **cancela su inscripción y luego vuelve**, se **revive la misma
  R1** con el **mismo link**. No nace una reserva nueva.

Consecuencia: como el capitán siempre lidera esa única R1 (viva o revivible), el
paso 1 de `carriedGroup` sigue devolviéndola sin ambigüedad; no hay "histórico" de
reservas terminales que consultar.

## 5. Máquina de estados de `counts_reserved_slot` (CONGELADA)

Para cada transición: `game_slot_reservation_id` resultante, `counts_reserved_slot`
resultante y explicación. "Hereda" = toma el `gsr_id` de `carriedGroup(actor)` o del
link. "Se conserva" = queda igual que antes de la transición.

| # | Transición | `game_slot_reservation_id` | `counts_reserved_slot` | Explicación |
|---|---|---|---|---|
| 1 | **Reserva inicial del capitán** (su propia fila) | R1 (la que lidera) | `false` | Es parte de la operación que *crea* el pool; no consume del pool que él mismo aparta. |
| 2 | **Invitados en la misma operación de reserva** | R1 (heredan) | `false` | Séquito inicial: ocupan asiento pero no descuentan del pool reservado (#5). |
| 3 | **Invitación posterior** (un miembro del grupo invita después) | grupo del invitador (`carriedGroup`) | `true` | Llegan después de crear la reserva: consumen un cupo reservado (#6). |
| 4 | **Ingreso por link** | reserva del link | `true` | Consume un cupo reservado del grupo del link (#6). |
| 5 | **Cancelación** | se conserva | sin cambio obligado | Deja de contabilizar por `status='canceled'`, no por modificar el booleano; la pertenencia persiste (#7). |
| 6 | **Reactivación del mismo row** (`canceled→confirmed` por link o invitación del grupo) | se conserva (mismo) | `true` | Vuelve a contar; mismo grupo, mismo `gsr_id` (#8). |
| 7 | **Pago propio sin link** | NULL | `false` | Fila nueva pública; no se consulta histórico (#9). Ver prioridad del liderazgo abajo. |
| 8 | **Pago propio con link** | reserva del link | `true` | Entra al grupo del link y consume (variante autopago de #6). |
| 9 | **Invitación por un jugador sin grupo** | NULL | `false` | `carriedGroup(invitador)=NULL` → el invitado nace público (#9). |
| 10 | **Invitación por un jugador con grupo** | grupo del invitador | `true` | Hereda el grupo del invitador y consume (#6). |

### Notas / bordes

- **Prioridad del liderazgo (regla general).** El paso 1 (liderazgo) de
  `carriedGroup` siempre tiene prioridad: si el actor lidera una reserva,
  `carriedGroup` devuelve esa reserva. Por tanto, un capitán que se reinscribe sin
  link vuelve a su propia R1 (`gsr_id = R1`, no NULL) y **no** nace como público. La
  fila 7 describe el caso genérico en que el actor ni lidera ni pertenece a un grupo.
- **Séquito vs. posteriores.** La frontera es la *operación*: quien entra dentro de la
  misma operación de reserva → `counts=false` (filas 1–2); quien entra después por
  cualquier vía dentro del grupo → `counts=true` (filas 3, 4, 6, 8, 10).
- **Pertenencia pegajosa.** En cancelación (fila 5) y reactivación (fila 6) el
  `game_slot_reservation_id` **no** se toca. En la cancelación el jugador deja de
  contabilizar por `status='canceled'`; en la reactivación vuelve a contar.
- **Público.** `gsr_id = NULL` ⇒ `counts_reserved_slot = false` siempre (no hay pool
  al que contar).

## 6. Qué NO se decide aquí (pendiente, no congelado)

- Cómo se mantiene `reserved_slots_used` (COUNT dinámico vs. sincronización).
- Firmas/cuerpos de las RPC y triggers.
- Si `reserved_slots_remaining` sigue siendo columna GENERATED o se recomputa.

Todo lo anterior a la sección 6 queda congelado.
