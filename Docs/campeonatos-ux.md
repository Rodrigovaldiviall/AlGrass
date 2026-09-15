# UX de Campeonatos — Lapichanga

Documento fuente de verdad del diseño actual de la funcionalidad de **Campeonatos** dentro de la app Lapichanga. Refleja el estado más reciente del prototipo (`Ver mi Torneo v3.dc.html`), que integra en un solo flujo: lista de campeonatos → organizar un campeonato nuevo → ver/gestionar un campeonato (inscripciones, equipos, resultados).

No incluye backend, base de datos ni arquitectura — solo UX y comportamiento funcional tal como está diseñado.

---

## 1. Mapa completo de pantallas

1. **Campeonato** (lista) — pantalla de entrada, reemplaza la sección de notificaciones en el tab bar inferior.
2. **Organiza tu campeonato** (disponibilidad / configuración) — se abre desde "Crear nuevo campeonato".
3. **Ver mi campeonato** (pantalla principal del campeonato) — con dos sub-modos: **Modo demostración** (para el organizador, antes de que el campeonato exista de verdad) y **Entrada real** (cuando un jugador entra desde la lista a un campeonato con inscripciones abiertas o resultados).
4. **Pantalla de equipo** (crear/editar equipo) — se abre desde "Ver mi campeonato".
5. **Modales/Sheets superpuestos** (no son pantallas de navegación completa, se listan en la sección 15):
   - Sheet de selección de distrito (múltiple)
   - Sheet de selección de cancha (múltiple)
   - Sheet de roster de equipo (en vista de resultados)
   - Modal de clave de acceso
   - Modal de "resultados privados" (bloqueado)

---

## 2. Navegación entre pantallas

```
Campeonato (lista)
 ├─ [Crear nuevo campeonato] → Organiza tu campeonato
 │                                   ├─ [← atrás] → Campeonato (lista)
 │                                   └─ [Ver mi campeonato] → Ver mi campeonato (modo demostración)
 │                                                                  ├─ [← atrás] → Organiza tu campeonato
 │                                                                  ├─ [Crear equipo] → Pantalla de equipo
 │                                                                  └─ [click en escudo de equipo] → Pantalla de equipo
 │                                                                                                        └─ [Guardar] → Ver mi campeonato
 │
 ├─ [tarjeta "Activos" → Inscripciones abiertas] → (si privado sin desbloquear: Modal clave de acceso) → Ver mi campeonato (entrada real, modo inscripciones)
 │                                                                                                              └─ [← atrás] → Campeonato (lista)
 │
 └─ [tarjeta "Históricos" → Resultados] → (si privado y resultados no públicos: Modal "resultados privados", no navega)
                                        → (si privado y resultados públicos, sin desbloquear: Modal clave de acceso)
                                        → Ver mi campeonato (entrada real, modo resultados)
                                              └─ [← atrás] → Campeonato (lista)
```

Reglas de navegación clave:
- El botón atrás en "Organiza tu campeonato" siempre vuelve a "Campeonato" (lista).
- El botón atrás en "Ver mi campeonato" depende del origen:
  - Si se llegó desde "Organiza tu campeonato" (flujo de creación / modo demostración) → vuelve a "Organiza tu campeonato".
  - Si se llegó desde la lista (entrada real a un campeonato existente) → vuelve directo a "Campeonato" (lista), saltándose "Organiza tu campeonato".
- "Guardar" en la pantalla de equipo siempre regresa a "Ver mi campeonato".

---

## 3. Pantalla: Campeonato (lista)

**Objetivo:** punto de entrada; listar campeonatos activos e históricos (hasta 14 días atrás) y permitir crear uno nuevo.

**Elementos visibles (de arriba a abajo):**
- Header azul (`#007BFF`), fijo arriba, con el título **"Campeonato"** (reemplaza lo que antes era "Notificaciones"/"Torneos" en el menú).
- Botón grande naranja **"Crear nuevo campeonato"** (icono +), estilo CTA principal (mismo tratamiento visual que el CTA de reservar partido: `#F5A524`, sombra `0 6px 18px rgba(245,165,36,0.40)`, radio 18px).
- Sección **"Activos"** (label en mayúsculas, gris, tracking 0.3px) — lista de tarjetas de campeonatos con estado `open` (inscripciones abiertas).
- Sección **"Históricos · últimos 14 días"** — lista de tarjetas de campeonatos con estado `results`, ordenadas por más reciente, filtradas a `daysAgo <= 14`.
- Tab bar inferior (4 iconos): Partidos, Canchas, **Campeonato** (activo, azul), Perfil.

**Tarjeta de campeonato (mismo diseño en ambas secciones):**
- Portada de 96px de alto con color de fondo (`coverTheme`) y degradado oscuro inferior.
- Pill de estado arriba-izquierda: **"Inscripciones abiertas"** (fondo azul) o **"Resultados"** (fondo negro `#1B1B1F`).
- Ícono de candado (arriba-derecha) si el campeonato es privado (`visibility: 'private'`).
- Nombre del campeonato superpuesto abajo, en blanco, bold.
- Fila de metadata: ícono de "2 personas" + "{N} equipos" · separador · formato ("Fútbol 7", etc.) · a la derecha:
  - En Activos: "Público" (azul) o "Privado" (gris).
  - En Históricos: "Hace N días" (gris claro).
- Subtítulo debajo de la metadata:
  - Activos: **"Armar equipos o inscribirse solo"**.
  - Históricos: **"Tabla de posiciones"** (si ≤6 equipos) o **"Llave eliminatoria"** (si >6 equipos).
- Las tarjetas históricas cuyo campeonato es privado y no permite resultados públicos se muestran con opacidad reducida (0.7) para insinuar que están bloqueadas, pero siguen siendo tocables (muestran el modal de bloqueo).

**Datos de ejemplo usados en el mock (`LIST_TOURNAMENTS`):**
| id | Nombre | Equipos | Formato | Estado | Visibilidad | Clave | Resultados públicos |
|---|---|---|---|---|---|---|---|
| t1 | Copa Barrio Cayma | 8 | Fútbol 7 | Activo (inscripciones) | Público | — | sí |
| t2 | Liga Interna Acme Corp | 12 | Fútbol 7 | Activo (inscripciones) | Privado | `2026` | sí |
| t3 | Pichanga de Verano Surco | 5 | Fútbol 5 | Histórico (resultados, hace 2 días) | Público | — | sí |
| t4 | Copa Aniversario Constructora Vega | 10 | Fútbol 7 | Histórico (resultados, hace 6 días) | Privado | `2026` | sí |

**CTAs y qué ocurre al pulsarlos:**
- **"Crear nuevo campeonato"** → navega a "Organiza tu campeonato" (pantalla de disponibilidad, estado limpio para configurar un torneo nuevo).
- **Tarjeta con estado `open`** (Activos):
  - Si público → entra directo a "Ver mi campeonato" en modo **entrada real / inscripciones**.
  - Si privado y no desbloqueado aún → abre el **Modal de clave de acceso**; al validar la clave correcta, entra a "Ver mi campeonato" en modo entrada real / inscripciones y recuerda el desbloqueo para esa sesión (no se vuelve a pedir la clave para ese campeonato).
- **Tarjeta con estado `results`** (Históricos):
  - Si público → entra directo a "Ver mi campeonato" en modo **entrada real / resultados**.
  - Si privado y `resultsPublic = false` → abre el **Modal "Resultados privados"** (bloqueo, no navega).
  - Si privado y `resultsPublic = true`, no desbloqueado → abre el **Modal de clave de acceso**; al validar, entra a resultados.

**Reglas UX relevantes:**
- Un campeonato privado siempre pide clave para **entrar a inscripciones**.
- Un campeonato privado con resultados también públicos pide la misma clave para ver resultados; si el organizador desactivó "Resultados públicos", nadie externo puede entrar a ver resultados (ni con clave) — se muestra el bloqueo informativo.
- El desbloqueo de clave es por sesión/estado de la app (una vez ingresada correctamente, no se vuelve a pedir para ese campeonato en esa sesión).

**Pantalla anterior:** ninguna (raíz) — o el resto de la app vía tab bar.
**Pantalla siguiente:** "Organiza tu campeonato" o "Ver mi campeonato" (entrada real), según el CTA pulsado.

---

## 4. Flujo completo para crear/armar un campeonato — pantalla "Organiza tu campeonato"

**Objetivo:** capturar formato, cantidad de equipos, cancha/fecha/horario (si aplica) para dejar todo listo antes de pasar a "Ver mi campeonato".

**Header:** azul, botón atrás (← vuelve a "Campeonato"), título centrado **"Organiza tu campeonato"**.

**Mensaje introductorio (siempre visible, arriba del todo):**
> "Disfruta de un torneo sin preocuparte por la organización: bríndanos los datos de formato y cancha, y nosotros nos encargamos del resto — cancha, árbitros, agua y mucho más. En "Ver mi campeonato" te mostraremos la fase de inscripciones y de resultados, para que todos puedan participar. Despreocúpate y juega."

**Estructura visual:** dos tarjetas blancas con borde separadas visualmente:
1. Tarjeta **"Formato"**
2. Tarjeta **"Cancha"** (solo visible si el formato es "Torneo 1 día")

### 4.1 Tarjeta "Formato"

- Título de sección: **"Formato"**.
- Dos botones tipo segmented, mutuamente exclusivos:
  - **"Torneo 1 día"** (antes llamado "relámpago" — el copy visible ya no usa esa palabra).
  - **"Liga"** (varios días).
- Debajo, un carrusel horizontal de chips de **formato de juego**: Fútbol 5 / Fútbol 6 / Fútbol 7 / Fútbol 8 (una sola selección). Este selector de formato de juego aparece tanto si elegiste "Torneo 1 día" como "Liga" — es compartido.
- Texto de ayuda dinámico (`formatHint`) debajo de los botones de formato.

**Si el formato es "Liga":**
- Dos inputs lado a lado: **"Equipos"** (placeholder "Ej. 10") y **"Jugadores"** (placeholder "Ej. 70").
- Los campos se calculan entre sí automáticamente según el formato de juego elegido (ej. si el formato es Fútbol 7 y escribes 10 equipos → Jugadores se autocompleta a 70; si escribes 70 jugadores → Equipos se autocompleta a 10, redondeando hacia arriba).
- Texto de ayuda: *"Escribe equipos o jugadores; calculamos el otro según el formato elegido."*
- Aviso destacado (fondo azul claro `#E8F1FF`):
  > **"Las ligas se coordinan a medida"** — "No pagarás aquí. Continúa con "Ver mi torneo": con la información que nos proporciones armamos el calendario de fechas y te contactamos."
- **No se muestra** la sección de rangos de equipos (4-6, 7-9, etc.), ni la recomendación de horas/canchas, ni la tarjeta "Cancha" completa (no hay selección de distrito, cancha, fecha ni grilla de horarios) — todo eso es exclusivo del formato "Torneo 1 día".

**Si el formato es "Torneo 1 día":**
- Título: **"¿Cuántos equipos participan?"** + subtítulo: *"Te sugerimos cuántas horas y canchas reservar según la cantidad de equipos."*
- Grilla 2 columnas de **rangos de equipos** (chips grandes, cada uno con ícono de "2 personas", nombre del rango y subtítulo de personas):
  | Rango | Equipos | Personas | Fases (horas/canchas) |
  |---|---|---|---|
  | r1 | 4 a 6 equipos | 28 a 42 personas | Partidos: 2 canchas × 2h |
  | r2 | 7 a 9 equipos | 49 a 63 personas | Partidos: 2 canchas × 3h |
  | r3 | 10 a 12 equipos | 70 a 84 personas | Partidos: 3 canchas × 4h |
  | r4 | 13 a 16 equipos | 91 a 112 personas | Ronda de 16 (4 canchas×2h) → Cuartos de final (4×1h) → Semifinales (2×1h) → 3er y 4to puesto (1×1h) → Final (1×1h) |
- Dentro de la misma grilla, una celda adicional (mismo estilo de chip, no un botón aparte): **"Prefiero que me contacten para personalizarlo"** — esta opción unifica lo que antes eran dos conceptos separados ("17 equipos a más" y "no estoy seguro"). Es un checkbox-card:
  - Al marcarla, se expande dentro de la misma tarjeta el texto: *"Continúa con "Ver mi torneo": nos pondremos en contacto contigo para coordinar todo."*
  - Al marcarla, se ocultan: la tarjeta "Cancha" completa (fecha, distrito, cancha, amenities, grilla de horarios) y la recomendación de horas.
  - El CTA final queda habilitado igual (no exige selección de horario).

- **Recomendación de horas/canchas** (solo si se eligió un rango de equipos, no si se marcó "prefiero que me contacten"): tarjeta azul claro con:
  - Ícono de check en círculo azul.
  - **"Recomendado: {N horas} · hasta {M canchas}"**.
  - *"Buscamos la mejor disponibilidad — puedes ajustarla. Partidos de 15 minutos + 5 de descanso."*
  - Si el rango tiene múltiples fases (caso 13-16 equipos), se listan debajo: nombre de fase + "{canchas} canchas · {horas}h" para cada una (Ronda de 16, Cuartos, Semifinales, 3er/4to, Final).

### 4.2 Tarjeta "Cancha" (solo si Formato = "Torneo 1 día" y NO se marcó "prefiero que me contacten")

- Título: **"Cancha"**.
- Carrusel horizontal de filtros:
  - Botón **"Distrito"** (o "Distrito · N" si hay N seleccionados) → abre sheet de selección múltiple de distritos.
  - Botón **"Cancha"** (o "Cancha · N") → abre sheet de selección múltiple de canchas (filtradas por el/los distrito(s) elegido(s) y por amenities activos).
  - Chips de **Amenities**: Parking, Duchas, Techado (selección múltiple, filtran las canchas candidatas).
- Selector de **fecha**: fila de chips día/fecha (ej. SÁB 02, DOM 03, LUN 04, MAR 05) — selección única.
- Bloque **"Selecciona canchas y horas"**:
  - Nombre de la cancha resuelta (auto o filtrada), con flechas ‹ › para pasar a la siguiente/anterior cancha candidata dentro del filtro actual, y contador "1/3" etc. (solo si hay más de una cancha candidata).
  - Dirección y distrito de la cancha debajo.
  - Leyenda de colores: Libre (blanco/borde gris) · Elegido (azul claro/borde azul) · Ocupado (gris `#E8E8EC`).
  - **Grilla horizontal**: columnas = canchas del venue (1 a 5), filas = horas (3:00pm a 9:00pm). Cada celda es tocable si está libre; toggle de selección múltiple de celdas. Al tocar una celda, se desmarca automáticamente "No encuentro la disponibilidad que busco" si estaba marcado.
  - Checkbox expandible **"No encuentro la disponibilidad que busco"**:
    - Al marcarlo: se deseleccionan todas las celdas de la grilla, y se expande el texto: *"No te preocupes: continúa con "Ver mi torneo". Con la información que nos proporciones, buscaremos la mejor opción para ti y te contactaremos."*
    - Al desmarcarlo: se recalcula y vuelve a aplicar la selección automática recomendada (no queda vacío).
    - Se marca automáticamente (sin que el usuario lo toque) si el sistema no logra encontrar disponibilidad exacta que cubra el patrón de horas/canchas recomendado en ninguna cancha del filtro actual.

### 4.3 Lógica de disponibilidad automática

- Al elegir un rango de equipos, el sistema busca automáticamente, entre las canchas del pool filtrado (por distrito/cancha/amenities elegidos), la que tenga exactamente la disponibilidad necesaria según el patrón de fases (por ejemplo, para 13-16 equipos: 4 canchas×2h, luego 4×1h, 2×1h, 1×1h, 1×1h) en la fecha elegida.
- Si ninguna cancha cubre el patrón exacto, se hace un "mejor esfuerzo" (greedy fill) tomando tantos huecos libres como sea posible en la cancha con más disponibilidad, y se marca automáticamente el estado "no encontramos disponibilidad exacta".
- El usuario puede pasar manualmente de cancha en cancha (flechas ‹ ›) dentro del pool filtrado; al cambiar de cancha se recalcula la mejor selección para esa cancha específica ("pinned").
- Cambiar distrito, cancha (filtro), amenities o fecha siempre recalcula la selección automática desde cero (a menos que haya una cancha "pinned" manualmente vía las flechas).

### 4.4 Barra de estado (footer, sobre el CTA)

Aparece condicionalmente, con estilos distintos:
- **Verde** (`#D7F0DD`) — cumple lo recomendado: *"{N} horas en {M} canchas seleccionadas" / "Cumple con lo recomendado para tu torneo."*
- **Ámbar** (`#FFF8EC`) — selección parcial, no cumple lo recomendado: *"{N} horas en {M} canchas seleccionadas" / "Es menos de lo recomendado. Si no encuentras el horario ideal, no te preocupes: continúa igual y te ayudamos a coordinarlo."*
- **Azul** (`#E8F1FF`) — no se encontró disponibilidad exacta en ninguna cancha del pool: *"No encontramos disponibilidad exacta en tu zona" / "No te preocupes: continúa y nosotros nos pondremos en contacto contigo para ayudarte a organizar tu torneo."*
- **Gris** (`#F2F2F4`) — hay selección pero no hay rango de equipos elegido (modo libre): solo el conteo de horas/canchas seleccionadas, sin subtítulo.
- No aparece barra si: no hay ninguna celda seleccionada y no se marcó "no encuentro disponibilidad" (`noAvailability` falso y `selectedCount === 0`).

### 4.5 CTA final y tab bar

- Botón **"Ver mi campeonato"** (naranja, mismo estilo CTA principal).
- **No exige** haber elegido cantidad de equipos, fecha ni horario — se puede continuar en blanco (fallback total a "que nos contacten").
- Solo se deshabilita si la prop `strictMinimum` está activa (tweak de comportamiento) y hay un rango elegido cuya selección no cumple lo mínimo recomendado, y no se marcó ninguno de los estados de "no disponibilidad"/"que me contacten".
- Debajo del CTA, tab bar de 3 iconos: Canchas (activo, azul), Avisos, Perfil.

**Pantalla anterior:** "Campeonato" (lista).
**Pantalla siguiente:** "Ver mi campeonato" (modo demostración) — lleva consigo: horas/canchas reservadas, si hubo match exacto o no, y la cantidad de equipos configurada (que determina cuántos equipos mock aparecen en "Ver mi campeonato").

---

## 5. Diferencias UX entre campeonato público y privado

| Aspecto | Público | Privado |
|---|---|---|
| Pill de visibilidad en lista | "Público" (azul) | "Privado" (gris) + ícono de candado en la portada |
| Entrar a inscripciones desde la lista | Directo, sin fricción | Requiere **clave de acceso** (modal) |
| Entrar a resultados desde la lista | Directo | Requiere clave de acceso — **salvo** que el organizador haya desactivado "Resultados públicos", en cuyo caso está bloqueado para todos (modal informativo, no se puede entrar) |
| Configuración por el organizador | Sección "Privacidad" no aplica pago/clave — se omite si no configuró privacidad | Organizador configura: clave de acceso única + toggle de "Resultados públicos" |
| Método de inscripción de invitados | Abierta a cualquiera vía enlace | Solo con la clave configurada (código único — ver sección 9; no hay opción de "lista de códigos", fue removida del diseño) |
| Pago al inscribirse (entrada real) | Sí — S/.20 (sin equipo) o S/.200 (crear equipo) | No — solo "Confirmar" sin cobro (el organizador ya coordinó el pago fuera de la app o el campeonato es corporativo) |

---

## 6. Selección/configuración de ciudad, venue, cancha, fecha y horarios

Ya detallado en la sección 4.2–4.3. Resumen de componentes reutilizables:
- **Sheet de distrito** (`isDistrictSheet`): lista de distritos únicos derivados de las canchas del catálogo (San Borja, San Isidro, Surco, Miraflores), cada fila con checkbox cuadrado, selección múltiple. Header del sheet: título "Elige distritos" + botón "Listo" (cierra el sheet, no descarta selección).
- **Sheet de cancha** (`isVenueSheet`): lista de canchas del pool filtrado por distrito(s)/amenities, mismo patrón de checkbox, título "Elige canchas".
- **Grilla de disponibilidad**: canchas del venue resuelto en columnas, horas (3pm–9pm, franjas de 1h) en filas. Estilo idéntico al de "Partidos y canchas" existente en la app (grilla, no lista vertical) — este fue un ajuste explícito para mantener consistencia visual con el resto del producto.
- **Catálogo mock de canchas** (`VENUES`): 8 canchas repartidas en 3 distritos (San Borja, San Isidro, Surco, Miraflores — 2 canchas cada uno), cada una con 3 a 5 canchas internas, amenities variados (parking/duchas/techado) y disponibilidad mock por fecha (incluye una fecha, "MAR 05", donde todas las canchas de todos los venues están 100% ocupadas — para probar el estado de "no disponibilidad").

---

## 7. Configuración de número de equipos/jugadores y demás opciones

- **Torneo 1 día:** selección de rango de equipos vía chips (ver tabla en sección 4.1). El rango determina automáticamente cuántas horas y canchas se necesitan (y en el caso 13-16, el desglose completo por fases de bracket).
- **Liga:** inputs numéricos libres de "Equipos" y "Jugadores", vinculados bidireccionalmente según el formato de juego (tamaño de equipo) elegido.
- **Formato de juego** (Fútbol 5/6/7/8): un solo selector compartido entre ambos modos (Torneo 1 día y Liga), afecta el cálculo equipos↔jugadores en Liga.
- No existen actualmente en el diseño: selector de "Extras" (medallas, copa, filmado) ni sección "Tu torneo incluye" en la pantalla de disponibilidad — **fueron removidos** de "Organiza tu campeonato" en una iteración posterior (se consideró redundante/duplicado). Estos conceptos de extras existieron en versiones anteriores del prototipo pero no están en el diseño final documentado aquí.

---

## 8. Flujo de creación y gestión de equipos

### 8.1 Modo demostración — sección "Inscripciones" en "Ver mi campeonato"

- Título **"Inscripciones"** + texto: *"Selecciona un equipo para sumarte o crea tu propio equipo e invita a tus amigos."*
- Grilla de escudos de equipo (ancho 68px cada uno): forma de escudo con color sólido de fondo y franja inferior (versión oscurecida del color) con el nombre del equipo en blanco.
- Botón azul **"Crear equipo"** (ícono +, ancho completo) → abre la pantalla de equipo en modo "nuevo equipo".
  - **Crear un equipo lo agrega inmediatamente a la lista visible** (grilla de escudos), sin necesidad de unirte a él — permite crear equipos "vacíos" para organizar después.
- Texto: *"¿No tienes equipo todavía? Únete a la lista general y luego te acomodamos."*
- Botón reversible **"Unirme sin equipo"** / **"Estás en la lista"** (mismo peso visual que "Crear equipo", para no sesgar hacia una sola opción) → agrega/quita a "Tú" de la lista de jugadores sin equipo.

### 8.2 Pantalla de equipo (crear/editar)

- Header azul: atrás (regresa a "Ver mi campeonato"), título dinámico (nombre del equipo o "Nuevo equipo"), botón **"Guardar"** (azul, texto) — si el nombre queda vacío al guardar, se autocompleta a "Nuevo equipo".
- Escudo grande centrado (120×140px) con el color y franja del equipo, nombre dentro de la franja.
- Selector de **color del equipo**: 10 swatches circulares de la paleta (`PALETTE`), con anillo de selección (doble sombra blanca+azul) en el color activo.
- Input de **nombre del equipo** (placeholder "Nombre del equipo").
- Lista de **jugadores del equipo**: cada fila con número de orden (1–7 numerado; a partir del 8, se muestra "-" en vez de número, para no revelar quién es titular), avatar circular con iniciales (color por hash del nombre), nombre.
- CTA inferior reversible: **"Únete al equipo"** (naranja) / **"En el equipo"** (verde `#D7F0DD`/`#1F6B36`, sin sombra) — al pulsar, suma/quita a "Tú" como jugador (entra como jugador #1 al unirte; se retira si ya estabas).
- Tab bar inferior de 4 iconos (Partidos, Canchas, Avisos, Perfil) — ninguno resaltado en esta pantalla.

**Reglas clave:**
- Crear equipo es independiente de unirse: puedes crear un equipo vacío sin unirte, o unirte a un equipo que ya existe sin haberlo creado.
- Nombre y color se editan en vivo directamente sobre el objeto `team` en el estado — no hay un "borrador" separado que se descarte.

### 8.3 Roster combinado de "Jugadores" (dentro de "Ver mi campeonato", modo inscripciones)

- Lista única con TODOS los jugadores de TODOS los equipos + los jugadores "sin equipo", numerados correlativamente sin reiniciar por equipo.
- **Orden:** "Tú" siempre primero (si te uniste a algún equipo o a la lista sin equipo); el resto ordenado alfabéticamente, agrupado por equipo (recorriendo los equipos en su orden de creación) y finalmente los "sin equipo" restantes, también alfabético.
- Cada fila: número, avatar (iniciales, color por hash del nombre), nombre, y a la derecha ícono de escudo + nombre del equipo (o "Sin equipo" en gris `#C7C7CC` como color de escudo).
- Contador arriba a la derecha: **"{N} inscritos"**.

---

## 9. Claves, invitaciones y formas de ingreso

### 9.1 Configuración por el organizador (sección "Privacidad" en "Ver mi campeonato", visible solo si NO es una entrada real — es decir, solo mientras el organizador está en modo demostración/configuración)

- Título **"Privacidad"**.
- Subtítulo: **"Configura clave de acceso"** + *"Con esta clave podrán acceder tus jugadores para organizarse."*
- **Solo existe una forma de inscripción: código único.** (La alternativa de "lista de códigos" con carga de Excel/CSV para códigos de empleado fue diseñada en una iteración anterior y luego **removida explícitamente** del flujo — ya no existe el selector "Código único" vs "Lista de códigos"; ahora es directamente un input de texto.)
- Input de texto: **"Comparte este código con tus invitados para que se inscriban."** (placeholder "Ej. PICHANGA2026").
- Toggle **"Resultados públicos"** (activado por defecto, invita a mantenerlo activo): *"Cualquiera con el enlace puede ver la llave y los resultados — ideal para que más gente siga tu torneo. Desactívalo para que solo lo vean los inscritos."*

### 9.2 Ingreso real de un jugador desde la lista (sección 3) a un campeonato privado

- **Modal "Clave de acceso"**: título, texto *"Este torneo es privado. Ingresa la clave de acceso configurada por el organizador."*, input de clave, mensaje de error *"Clave incorrecta. Intenta de nuevo."* si no coincide, botones "Cancelar" / "Entrar".
- Comparación case-insensitive contra la clave configurada del campeonato (mock: `2026` para ambos ejemplos privados).
- Al validar correctamente, se recuerda el desbloqueo (no se vuelve a pedir esa sesión) y navega directo a la pantalla correspondiente (inscripciones o resultados).

### 9.3 Modal "Resultados privados" (bloqueo)

- Se muestra cuando el campeonato es privado Y el organizador desactivó "Resultados públicos" — sin importar si tienes la clave o no, nadie externo puede ver esos resultados.
- Ícono de candado, título **"Resultados privados"**, texto: *"El organizador de este torneo no permite ver los resultados públicamente."*, botón **"Entendido"** (solo cierra el modal, no navega a ningún lado).

---

## 10. Inscripción individual (entrada real, no modo demostración)

Cuando un jugador entra desde la lista a un campeonato con **inscripciones abiertas** (`entry=inscripciones`):

- La pantalla "Ver mi campeonato" se muestra en modo **entrada real** (`isRealEntry: true`), ocultando las secciones "Privacidad" y "Modo demostración" (esas son solo herramientas del organizador).
- El resto de la UI de inscripciones (grilla de escudos, "Crear equipo", "Unirme sin equipo", roster combinado) es idéntica a la del modo demostración.
- **Precios:**
  - Unirse **sin equipo** → **S/.20**.
  - **Crear un equipo** o **unirse a un equipo existente** → **S/.200**.
- El CTA final del footer cambia dinámicamente según la "intención" (`joinIntent`) del usuario:
  - Sin ninguna acción todavía → botón deshabilitado, label **"Elige cómo participar"**, hint: *"Crea un equipo (S/.200) o únete sin equipo (S/.20)."* (si es público) o *"Únete sin equipo, a un equipo, o crea uno."* (si es privado).
  - Tras "Unirme sin equipo" → **"Confirmar por S/.20"**.
  - Tras crear equipo o unirse a un equipo (`joinTeam`) → **"Confirmar por S/.200"**.
  - Si el campeonato es **privado** → nunca hay cobro: una vez elegida cualquier intención, el botón es simplemente **"Confirmar"**, hint: *"Torneo privado — sin pago, solo confirmación."*
- Al pulsar el CTA final (`onFinalCta`), se muestra un toast: *"Confirmando tu inscripción…"* (privado) o *"Procesando tu pago…"* (público) — no hay pantalla de pago real modelada, es un mock de confirmación.
- El botón atrás en este modo vuelve directo a "Campeonato" (lista), no a "Organiza tu campeonato".

---

## 11. Vista del campeonato una vez creado ("Ver mi campeonato")

**Header:** azul, atrás, título fijo **"Ver mi campeonato"** (ya no muestra el nombre del campeonato en el header — eso se ve en la portada), pill a la derecha con **"{N} jugadores"**.

**Cuerpo (de arriba a abajo, modo demostración):**
1. **Portada editable** (180px alto): color de fondo o foto (image-slot), degradado inferior, botón **"Editar portada"** (esquina superior derecha), input de **nombre del campeonato** superpuesto sobre la portada (editable in-place).
   - Al tocar "Editar portada" se expande un panel con: input de nombre del campeonato (duplicado aquí para editar sin volver a la portada), 5 swatches de tema de color (misma paleta de escudos) y un botón "+ foto" con ícono de cámara para pasar a modo foto (usa `<image-slot>` para drag&drop de imagen real).
2. **Resumen de reserva** (3 filas con ícono + texto, separadas por hairline):
   - Fecha + "Fase de grupos".
   - Nombre y dirección de la cancha resuelta — **si no se encontró disponibilidad** (se marcó "no encuentro disponibilidad" o "prefiero que me contacten"), se muestra en su lugar: **"Pendiente por confirmar"** / *"Te contactaremos para coordinar la sede y el horario."*
   - Horas y canchas reservadas ("{M} canchas · {N}h reservadas") + "Fútbol 7 · Aire libre" — o "Cancha por confirmar" si no hay disponibilidad resuelta.
3. Chips: **"{N} equipos"** + formato ("Fútbol 7").
4. **Descripción**: texto fijo de ejemplo — *"Cada equipo juega 3 partidos en la fase de grupos. Los dos primeros de cada grupo avanzan a semifinales."*
5. **Privacidad** (solo si NO es entrada real — ver sección 9.1).
6. **Modo demostración** (solo si NO es entrada real): dos botones — **"Demostración inscripciones"** / **"Demostración resultados"** — con un texto explicativo que cambia según cuál esté activo:
   - Inscripciones: *"Así se organizan solos tus jugadores: pueden crear su propio equipo o anotarse sin equipo y los acomodas después."*
   - Resultados: *"Así se ve la llave del torneo una vez armada, con los equipos inscritos ubicados en el cuadro eliminatorio."*
7. Contenido según el sub-modo activo (Inscripciones o Resultados) — ver secciones 8 y 13.
8. **Footer:** CTA principal + tab bar de 4 iconos (Partidos, Canchas, Avisos, Perfil) — **excepto en modo Resultados de una entrada real**, donde el CTA se oculta por completo (no hay botón de confirmar/pagar; solo se ven resultados).

**Datos mock de equipos generados automáticamente:**
- Los nombres de equipo y jugadores se generan proceduralmente (`buildTeams(count)`) a partir de listas de nombres/apellidos predefinidas, con colores tomados round-robin de la paleta de 10 colores.
- La cantidad de equipos mock generados depende del rango elegido en "Organiza tu campeonato" (`RANGE_TEAM_COUNT`: r1→4, r2→7, r3→10, r4→13); si no se eligió rango, por defecto 4.
- Cada equipo mock arranca con exactamente **1 jugador** (antes tenía 5-6, se redujo para minimizar el ruido del mock).

---

## 12. Equipos y roster

Ver sección 8.2 y 8.3 para el detalle completo de creación de equipo y roster combinado. Componentes reutilizados:
- **Escudo de equipo** (SVG con `path` de forma de escudo + franja de nombre) — usado en: grilla de inscripciones, roster combinado, tabla de posiciones, llave eliminatoria, goleadores, sheet de roster.
- **Avatar de jugador** (círculo con iniciales, color por hash del nombre) — usado en: roster combinado, pantalla de equipo, sheet de roster de equipo (resultados), goleadores.

---

## 13. Fixture, grupos, llaves y resultados (sub-modo "Demostración resultados" / entrada real "resultados")

### 13.1 Selector de vista (siempre 3 opciones, independientes entre sí)

Fila de 3 botones tipo segmented: **Tabla** / **Llave** / **Partidos**. Cualquiera de las 3 vistas está disponible sin importar la cantidad de equipos (el sistema sugiere una por defecto según la cantidad, pero el usuario puede cambiar libremente):
- Por defecto: **Tabla** si es formato Liga o si hay ≤6 equipos; **Llave** si hay >6 equipos (torneo eliminatorio).
- Las 3 vistas coexisten — se puede ver la tabla de posiciones y también los partidos, o la llave y también los partidos, sin que una excluya a la otra.

### 13.2 Vista "Tabla" — Tabla de posiciones (todos contra todos)

- Título **"Tabla de posiciones"** + contador "{N} equipos" a la derecha.
- Tabla con la **columna "Equipo" fija** (no se desplaza) a la izquierda, y el resto de columnas **desplazable horizontalmente** por separado (scroll-x independiente): **PJ, G, E, P, Pts, GF, GC, DG** (en ese orden exacto — P antes de Pts, Pts antes de GF) + columna **"Partidos"** con iconos de resultado.
- Cada fila de equipo es tocable (botón) → abre el sheet de roster de ese equipo con vista de partidos.
- Columna "Partidos" (resultados icon-row): un ícono circular por partido jugado — ✓ verde (`#1F6B36`) ganado, ✕ rojo (`#C0392B`) perdido, — gris (`#C7C7CC`) empate.
- Pts se resalta en azul y bold; DG en negro bold; el resto en peso normal.
- Texto de ayuda debajo: *"Todos contra todos — toca un equipo para ver sus partidos."*
- Alturas de fila idénticas entre la columna fija y las desplazables (34px header, 42px filas) para mantener alineación visual exacta.

### 13.3 Vista "Llave" — Llave eliminatoria

- Título **"Llave del torneo"** + contador de equipos.
- Columnas de ronda (ej. Octavos, Cuartos, Semifinal, Final, ... simétrico hacia el otro lado) distribuidas equitativamente en el ancho de pantalla (sin ancho fijo por columna, para no desordenar el centrado al enfocar una).
- Cada partido es un par de **escudos verticales** (o, para la Final, **dos escudos horizontales lado a lado** representando el punto de encuentro de ambas ramas) con el nombre del equipo dentro/debajo del escudo y un badge de marcador flotante si ya se jugó.
- El bloque de la **Final** siempre se posiciona centrado en la altura media entre las dos semifinales que la alimentan.
- Debajo de la Final hay un bloque adicional, también horizontal, etiquetado **"3ro y 4to"** (partido por el tercer puesto), posicionado un poco más arriba/pegado a la Final (no centrado, simplemente cerca) para no ocupar scroll innecesario.
- Los emparejamientos sin equipo definido todavía se muestran como una **silueta de escudo punteada** (mismo path SVG, sin relleno, borde punteado gris) en vez de una caja de texto "A definir" — mantiene la consistencia visual del ícono en todos los estados.
- **Tocar el nombre/label de una ronda** (ej. "Cuartos de final") **agranda** los escudos y nombres de esa columna específica para poder leerlos bien (el nombre puede partirse en 2 líneas dentro del escudo agrandado); las demás columnas mantienen su tamaño normal y posición (no se comprimen ni desordenan). Tocar de nuevo la misma ronda la vuelve a su tamaño normal.
- Cuando hay una columna enfocada/agrandada, se reserva espacio extra debajo de la llave para que no se sobreponga con la sección "Goleadores".
- Tocar cualquier escudo con equipo asignado (ya sea en tamaño normal o enfocado) abre el **sheet de roster** de ese equipo (ver 13.5).
- Un solo partido de ejemplo por lado del bracket viene pre-cargado con marcador (ej. 2-1), y ese ganador ya aparece avanzando visualmente a la siguiente ronda de ese lado — para demostrar cómo se ve un resultado ya jugado.

### 13.4 Vista "Partidos"

- **Sin equipo seleccionado** (`!fixtureTeam`):
  - Título **"Próximos partidos"** + *"Toca un equipo en la Tabla para ver solo su próximo partido y su historial."*
  - Lista de **"Próximos partidos"**: todos los partidos aún no jugados de todos los equipos, cada tarjeta con ambos escudos+nombres a la izquierda y venue/cancha/fecha/hora a la derecha.
  - Debajo, sección **"Partidos jugados"** (label en mayúsculas): **todo el historial** de partidos ya completados de todos los equipos, cada tarjeta con ambos equipos y su marcador final. Si no hay ninguno jugado: *"Todavía no se ha jugado ningún partido."*
- **Con un equipo seleccionado** (`fixtureTeam`, llegado desde tocar un equipo en Tabla o en Llave):
  - Botón **"‹ Todos los partidos"** (vuelve a la vista sin filtro).
  - Escudo + nombre del equipo seleccionado.
  - Sección **"Próximo partido"** (mayúsculas): una sola tarjeta con el siguiente partido programado de ese equipo, o *"Sin partidos programados por ahora."* si no tiene.
  - Sección **"Partidos jugados"**: solo el historial de ese equipo específico (no de todos), o *"Todavía no ha jugado ningún partido."* si no tiene ninguno.
- El fixture completo (`buildFixtures`) es un "todos contra todos" generado proceduralmente: cada par de equipos tiene un partido con estado completado/pendiente (determinístico por hash del nombre), marcador si está completado, y venue/cancha/fecha/hora asignados round-robin del catálogo mock.

### 13.5 Sheet de roster de equipo (desde Tabla o Llave)

- Se abre como bottom-sheet (70% alto máx) al tocar cualquier equipo con nombre asignado.
- Header del sheet: escudo + nombre del equipo, botón "Listo" (cierra).
- Lista de jugadores del equipo, **ordenados por goles** (descendente), cada fila: avatar+iniciales, nombre, goles anotados a la derecha.

### 13.6 Goleadores (siempre visible debajo de Tabla/Llave, no depende de la vista activa — solo se oculta en la vista "Partidos")

- Título **"Goleadores"**.
- Lista de TODOS los jugadores de TODOS los equipos + sin equipo, ordenados por goles descendente, con **"Tú" siempre primero** si participaste.
- Cada fila: número de puesto, avatar, nombre, escudo+nombre del equipo, goles (solo el número, sin la palabra "goles").
- Los goles son un valor mock determinístico por hash del nombre (excepto "Tú", que siempre tiene 4).

---

## 14. Pantallas/acciones del organizador (host) ya contempladas

Todas viven dentro de "Ver mi campeonato" cuando **no** es una entrada real (es decir, el organizador llegó desde "Organiza tu campeonato"):
- Editar portada (foto o tema de color) y nombre del campeonato, en cualquier momento, in-place.
- Configurar clave de acceso única (si el campeonato es privado, aunque el toggle de "privado" en sí ya no existe como tal — ver nota en sección 15).
- Activar/desactivar "Resultados públicos".
- Cambiar libremente entre "Demostración inscripciones" y "Demostración resultados" para previsualizar ambas fases sin que eso represente un estado real del campeonato.
- Crear equipos vacíos para pre-organizar (sin necesidad de unirse).
- Volver a "Organiza tu campeonato" (botón atrás) para reconfigurar formato/cancha/fecha/horario antes de publicar.

**Nota:** no hay actualmente un toggle explícito "Torneo privado" separado — la sección "Privacidad" combina directamente la configuración de la clave de acceso (que implica privacidad) con el toggle de "Resultados públicos". No existe un modal ni flujo de "publicar" el campeonato una vez configurado — se asume que salir de esta pantalla ya deja el campeonato configurado.

---

## 15. Estados vacíos, mensajes, modales, sheets, CTAs y validaciones

### Modales (overlay centrado, fondo oscuro semitransparente `rgba(0,0,0,0.4)`, tarjeta blanca redondeada 20px)
- **Clave de acceso** (sección 9.2).
- **Resultados privados** (bloqueo) (sección 9.3).

### Bottom sheets (overlay inferior, fondo oscuro `rgba(0,0,0,0.35)`, panel blanco redondeado arriba 20px, máx 70% alto)
- Sheet de **selección de distrito** (múltiple, checkbox).
- Sheet de **selección de cancha** (múltiple, checkbox).
- Sheet de **roster de equipo** (resultados) (solo lectura, ordenado por goles).

### Toasts (banda oscura flotante arriba, autodescarta ~1.8-2.6s)
- "Abriendo tu torneo…" / variantes al confirmar disponibilidad (mock, en pantallas antiguas — puede no estar presente en el flujo final si fue reemplazado por el `onFinalCta` de entrada real).
- "Confirmando tu inscripción…" / "Procesando tu pago…" (entrada real, al pulsar CTA final).
- "Abriendo {nombre}…" (fallback genérico si un estado de torneo en la lista no es `open` ni `results`).
- Toast de bloqueo cuando se intenta navegar a "Ver mi campeonato" desde el export offline/standalone (no aplica al producto real, es una salvaguarda del prototipo exportado).

### Validaciones y estados deshabilitados
- CTA de "Organiza tu campeonato" deshabilitado solo si `strictMinimum` está activo y la selección no alcanza el mínimo recomendado (comportamiento opt-in, no es el default).
- CTA de entrada real deshabilitado hasta que el usuario elija una intención de participación (crear equipo / unirse a equipo / unirse sin equipo).
- Modal de clave: error inline *"Clave incorrecta. Intenta de nuevo."* si no coincide (no cierra el modal, permite reintentar).

### Estados vacíos
- "Sin partidos programados por ahora." (equipo sin próximo partido).
- "Todavía no ha jugado ningún partido." (equipo sin historial).
- "Todavía no se ha jugado ningún partido." (nadie ha jugado, vista general).

---

## 16. Textos/copy importantes (verbatim)

- "Disfruta de un torneo sin preocuparte por la organización: bríndanos los datos de formato y cancha, y nosotros nos encargamos del resto — cancha, árbitros, agua y mucho más. En "Ver mi campeonato" te mostraremos la fase de inscripciones y de resultados, para que todos puedan participar. Despreocúpate y juega."
- "Te sugerimos cuántas horas y canchas reservar según la cantidad de equipos."
- "Prefiero que me contacten para personalizarlo"
- "Continúa con "Ver mi torneo": nos pondremos en contacto contigo para coordinar todo."
- "Buscamos la mejor disponibilidad — puedes ajustarla. Partidos de 15 minutos + 5 de descanso."
- "Las ligas se coordinan a medida" / "No pagarás aquí. Continúa con "Ver mi torneo": con la información que nos proporciones armamos el calendario de fechas y te contactamos."
- "Escribe equipos o jugadores; calculamos el otro según el formato elegido."
- "No encuentro la disponibilidad que busco" / "No te preocupes: continúa con "Ver mi torneo". Con la información que nos proporciones, buscaremos la mejor opción para ti y te contactaremos."
- "No encontramos disponibilidad exacta en tu zona" / "No te preocupes: continúa y nosotros nos pondremos en contacto contigo para ayudarte a organizar tu torneo."
- "Es menos de lo recomendado. Si no encuentras el horario ideal, no te preocupes: continúa igual y te ayudamos a coordinarlo."
- "Cumple con lo recomendado para tu torneo."
- "Configura clave de acceso" / "Con esta clave podrán acceder tus jugadores para organizarse."
- "¿Cómo se inscribirán los invitados?"
- "Comparte este código con tus invitados para que se inscriban."
- "Resultados públicos" / "Cualquiera con el enlace puede ver la llave y los resultados — ideal para que más gente siga tu torneo. Desactívalo para que solo lo vean los inscritos."
- "Modo demostración" / "Demostración inscripciones" / "Demostración resultados"
- "Así se organizan solos tus jugadores: pueden crear su propio equipo o anotarse sin equipo y los acomodas después."
- "Así se ve la llave del torneo una vez armada, con los equipos inscritos ubicados en el cuadro eliminatorio."
- "Inscripciones" / "Selecciona un equipo para sumarte o crea tu propio equipo e invita a tus amigos."
- "Crear equipo"
- "¿No tienes equipo todavía? Únete a la lista general y luego te acomodamos."
- "Unirme sin equipo" / "Estás en la lista"
- "Jugadores" / "{N} inscritos"
- "Sin equipo"
- "Guardar" / "Nuevo equipo" (fallback de nombre vacío)
- "Color del equipo" / "Nombre del equipo"
- "Únete al equipo" / "En el equipo"
- "Cada equipo juega 3 partidos en la fase de grupos. Los dos primeros de cada grupo avanzan a semifinales." (descripción fija de ejemplo)
- "Pendiente por confirmar" / "Te contactaremos para coordinar la sede y el horario." / "Cancha por confirmar"
- "Este torneo es privado. Ingresa la clave de acceso configurada por el organizador."
- "Clave incorrecta. Intenta de nuevo."
- "Resultados privados" / "El organizador de este torneo no permite ver los resultados públicamente."
- "Tabla de posiciones" / "Llave eliminatoria" (subtítulos de tarjeta en lista)
- "Armar equipos o inscribirse solo" (subtítulo de tarjeta activa en lista)
- "Todos contra todos — toca un equipo para ver sus partidos."
- "Próximos partidos" / "Toca un equipo en la Tabla para ver solo su próximo partido y su historial."
- "Partidos jugados" / "Próximo partido"
- "Sin partidos programados por ahora." / "Todavía no ha jugado ningún partido." / "Todavía no se ha jugado ningún partido."
- "Todos los partidos" (botón de volver desde vista filtrada por equipo)
- "Goleadores"
- "3ro y 4to" (etiqueta de partido por el tercer puesto en la llave)
- "Elige cómo participar" / "Crea un equipo (S/.200) o únete sin equipo (S/.20)." / "Únete sin equipo, a un equipo, o crea uno."
- "Confirmar por S/.20" / "Confirmar por S/.200" / "Confirmar" (privado, sin cobro)
- "Torneo privado — sin pago, solo confirmación."
- "Confirmando tu inscripción…" / "Procesando tu pago…"
- "Crear nuevo campeonato"
- "Activos" / "Históricos · últimos 14 días"
- "Inscripciones abiertas" / "Resultados" (pills de estado)
- "Público" / "Privado"
- "Hace 1 día" / "Hace {N} días"

---

## 17. Variantes y estados visuales existentes

- **Portada del campeonato:** color de tema (5 swatches de la paleta) vs. foto subida por el usuario (image-slot).
- **CTA "Unirme sin equipo" / botón de equipo:** estado no unido (naranja, sombra) vs. unido (verde `#D7F0DD`/`#1F6B36`, sin sombra, ícono check).
- **Chips de rango de equipos / formato / amenities / distrito / cancha:** estado inactivo (blanco, borde gris) vs. activo (azul claro `#E8F1FF`, texto azul, sin borde).
- **Celdas de la grilla de horarios:** Libre / Elegido / Ocupado (3 estados visuales, ver leyenda sección 4.2).
- **Checkbox-card "No encuentro la disponibilidad que busco" / "Prefiero que me contacten":** colapsado vs. expandido (con texto adicional dentro de la misma tarjeta, no un cuadro separado).
- **Barra de estado inferior en disponibilidad:** verde / ámbar / azul / gris / oculta (5 estados, sección 4.4).
- **Resultado de partido (icono):** ✓ ganado (verde) / ✕ perdido (rojo) / — empate (gris), en la tabla de posiciones.
- **Llave eliminatoria — escudo de slot:** con equipo asignado (color sólido) vs. sin definir (silueta punteada gris) vs. enfocado/agrandado (al tocar el label de la ronda) vs. normal.
- **Tarjeta de campeonato en lista:** estado "Activos" (pill azul, subtítulo de inscripciones) vs. "Históricos" (pill negro, subtítulo de tabla/llave, opacidad reducida si está bloqueado).
- **Formato del torneo:** "Torneo 1 día" (con toda la tarjeta "Cancha" visible) vs. "Liga" (sin tarjeta "Cancha", con inputs de equipos/jugadores en su lugar).
- **Vista de resultados:** Tabla / Llave / Partidos — y dentro de Partidos: filtrado por equipo vs. general.
- **Modo de la pantalla "Ver mi campeonato":** demostración (organizador, con secciones Privacidad/Modo demostración visibles) vs. entrada real (jugador, esas secciones ocultas, CTA de pago/confirmación en su lugar, y sin CTA alguno si es la vista de resultados).

---

## 18. Componentes visuales reutilizados entre pantallas

- **Escudo de equipo (SVG shield)** — path fijo `M50 4 L92 20 V56 C92 88 72 104 50 112 C28 104 8 88 8 56 V20 Z`, con franja/ribbon oscurecida (`darken()` del color base) conteniendo el nombre. Usado en: grilla de inscripciones, pantalla de equipo, roster combinado, tabla de posiciones, llave eliminatoria, sheet de roster, goleadores, partidos.
- **Avatar circular con iniciales** — color determinístico por hash del nombre (`hashColor`), excepto que el usuario "Tú" siempre tiene sus propias reglas de orden (primero en las listas). Usado en: roster combinado, pantalla de equipo, sheet de roster, goleadores.
- **Chip toggle** (blanco/borde gris inactivo, azul claro/texto azul activo) — usado en: rangos de equipo, formato de juego, amenities, distrito/cancha (botones que abren sheet), formato torneo/liga, tabs Tabla/Llave/Partidos, tabs Demostración inscripciones/resultados.
- **Checkbox-card expandible** (icono checkbox cuadrado + label + contenido adicional que se revela al activar, todo dentro de la misma tarjeta) — usado en: "Prefiero que me contacten", "No encuentro la disponibilidad que busco", toggle de "Resultados públicos".
- **Bottom sheet genérico** (header con título + "Listo", lista scrolleable) — usado para distrito, cancha, roster de equipo en resultados.
- **CTA principal** (naranja `#F5A524`, radio 18px, sombra `0 6px 18px rgba(245,165,36,0.40)`, texto bold blanco/oscuro) — usado en: "Ver mi campeonato" (disponibilidad), "Crear nuevo campeonato" (lista), CTA de entrada real (pago/confirmación).
- **Tab bar inferior** (4 iconos con label, 56px alto, hairline superior) — presente en todas las pantallas principales, con el ícono activo en azul; varía el ítem resaltado y a veces la cantidad de iconos (3 en "Organiza tu campeonato": Canchas/Avisos/Perfil, sin "Partidos"; 4 en el resto).
- **Header azul fijo** (`#007BFF`, padding `54px 12-16px 14px`, safe-area-aware) con botón atrás opcional y título centrado o alineado a la izquierda según la pantalla.

---

## PENDIENTES / NO DEFINIDO

- No está definido qué ocurre tras pulsar "Confirmar" en el flujo de inscripción real (público o privado) más allá del toast de mock ("Confirmando tu inscripción…" / "Procesando tu pago…") — no hay pantalla de pago, recibo, ni confirmación final diseñada.
- No está definido el comportamiento de "editar" un campeonato ya publicado desde la lista (por ejemplo, cambiar fecha/cancha después de que ya hay equipos inscritos) — el botón atrás desde "Ver mi campeonato" en modo demostración vuelve a "Organiza tu campeonato", pero no hay un flujo explícito de "publicar" vs. "borrador".
- No está definido si el organizador puede editar la clave de acceso o el toggle de "Resultados públicos" después de que el campeonato ya tiene inscritos.
- No está definido cómo se transiciona de "modo demostración" a un campeonato "real" con datos reales — actualmente son dos experiencias separadas en el mismo componente (demostración usa datos 100% mock; entrada real reutiliza la misma UI de inscripciones pero con los mismos datos mock, sin conexión real).
- No está definido qué pasa si un jugador entra a un campeonato en modo "resultados" que aún no tiene ningún partido jugado, más allá de los estados vacíos genéricos ya listados.
- No está definido el detalle de "Avisos" ni "Perfil" (tabs del tab bar) — están fuera del alcance de este diseño.
- No está definido si existe algún límite de campeonatos "Activos" visibles, paginación, o búsqueda/filtro dentro de la lista "Campeonato".
- No está definido el comportamiento cuando "Liga" se confirma (qué es exactamente lo que se le comunica al equipo de operaciones, más allá del mensaje "armamos el calendario de fechas y te contactamos").
- No está definido si "Extras" (medallas, copa, filmado) siguen siendo parte del producto — fueron removidos de la pantalla de disponibilidad en una iteración posterior sin que se especificara un lugar alternativo para configurarlos.
