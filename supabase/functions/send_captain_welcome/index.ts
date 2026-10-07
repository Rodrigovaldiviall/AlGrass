// ── Edge Function send_captain_welcome — el que vacía la cola ──────────────────
//
// Lee `public.captain_welcome_emails`, manda por Resend lo que esté pendiente y
// anota qué pasó. Nada más. NO decide quién es Capitán, no lee `user_roles` y no
// toca `captain_requests`: para cuando una fila llega aquí, el rol ya está
// concedido y esta función no puede quitárselo a nadie.
//
// ── EL FALLO DEL CORREO NO PUEDE AFECTAR AL ROL ───────────────────────────────
//
// Esta función solo escribe en `captain_welcome_emails`, y solo en las columnas
// de estado. Aunque Resend estuviera caído una semana, lo único que pasaría es
// que se acumularían filas en `failed` y el siguiente barrido las reintentaría.
//
// ── RECLAMAR ANTES DE ENVIAR ──────────────────────────────────────────────────
//
// Cada fila se pasa a 'sending' llamando a `claim_captain_welcome_email`, que en
// una sola sentencia condiciona por el estado anterior, estampa `claimed_at` con
// el reloj de la BASE e incrementa `attempts`.
//
// El `where` sobre el estado es un compare-and-set: si dos barridos coinciden,
// el segundo actualiza CERO filas, no recibe nada y pasa a la siguiente. Y como
// esa condición nombra los dos únicos estados de partida, es IMPOSIBLE que esta
// función toque una fila 'skipped' —los capitanes que ya existían— o una 'sent'.
//
// Va por RPC y no por un UPDATE desde aquí para que quien ESTAMPA la hora y
// quien la COMPARA sean el mismo reloj. Con dos relojes distintos, el umbral de
// recuperación significaría cosas distintas según quién mirase.
//
// ── LAS RECLAMACIONES CADUCAN ─────────────────────────────────────────────────
//
// Si el isolate muere entre reclamar y anotar el resultado, la fila se quedaría
// en 'sending' para siempre: el barrido solo mira 'pending' y 'failed'. Por eso
// cada ejecución empieza devolviendo a la cola lo que lleve reclamado más de
// quince minutos —ver la migración para por qué quince—.
//
// Vuelven como 'failed' y no como 'pending': el intento ya se gastó al
// reclamarlas, y regalárselo haría que una fila que cuelga se reintentara
// eternamente. Al reintentarse llevan la MISMA `Idempotency-Key`, la de su id,
// así que si el correo llegó a salir Resend no manda un segundo.
//
// ── DOS CINTURONES CONTRA EL DUPLICADO ────────────────────────────────────────
//
//   1. la máquina de estados de arriba, que es la que manda;
//   2. la `Idempotency-Key` de Resend, con el id de la fila. Cubre el hueco de
//      que el isolate muera DESPUÉS de que Resend acepte el correo y ANTES de
//      poder anotarlo: al reintentar, Resend devuelve la misma respuesta sin
//      volver a enviar. Sus claves caducan a las 24 h, así que es una red de
//      seguridad para el reintento inmediato, no el mecanismo principal.
//
// ── QUIÉN PUEDE LLAMARLA ──────────────────────────────────────────────────────
//
// Dos capas, y hacen falta las dos:
//
//   1. la verificación de JWT de la plataforma, que exige un `Authorization`
//      válido del proyecto. Filtra a los desconocidos, pero NO basta: acepta el
//      token de cualquier usuario con sesión, y un jugador cualquiera podría
//      disparar el barrido;
//   2. `CAPTAIN_WELCOME_WORKER_SECRET`, en la cabecera `x-worker-secret`. Este
//      es el que de verdad autoriza, y lo conocen únicamente el cron y quien
//      administre el proyecto.
//
// EL SECRETO ES NUESTRO A PROPÓSITO. La versión anterior comparaba el bearer
// contra `SUPABASE_SERVICE_ROLE_KEY`, y eso ataba la autorización al valor
// exacto de una variable que Supabase controla y está migrando al sistema nuevo
// de claves. Un secreto propio no cambia bajo nuestros pies.
//
// `SUPABASE_SERVICE_ROLE_KEY` sigue usándose, pero solo para lo que es: abrir el
// cliente que habla con la base. Ya no decide quién entra.
//
// La comparación es en tiempo constante. Con un secreto largo la fuga por
// tiempos es teórica, pero cuesta cuatro líneas y así no hay que razonarlo.
//
// ── LO QUE TODAVÍA NO EXISTE ──────────────────────────────────────────────────
//
// No hay trigger que llene la cola ni cron que llame aquí. Hoy esta función solo
// se ejecuta si alguien la invoca a mano, y con la cola sembrada entera como
// 'skipped' no encontrará nada que hacer. Es deliberado: se prueba primero, se
// conecta después.
//
// Cuando llegue el cron, su `net.http_post` tendrá que mandar las DOS cabeceras:
// el `Authorization` que exige la plataforma y el `x-worker-secret` de aquí. Las
// dos saldrán de Vault, no escritas en el `cron.schedule`.
//
// El correo es PROVISIONAL y se nota al leerlo. El definitivo es otra fase.
import { createClient } from '@supabase/supabase-js';
import { PLANTILLA_BIENVENIDA } from './plantilla.ts';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-worker-secret'
};
const json = (body, status = 200)=>new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      'Content-Type': 'application/json'
    }
  });
/** El remitente verificado. */ const FROM = 'AlGrass <noreply@algrass.com>';
/** Cuántas filas por invocación. Con el cron cada pocos minutos sobra de largo. */ const BATCH = 25;
/**
 * Cuántas veces se reintenta antes de dejarla en paz.
 *
 * Al llegar al tope la fila se queda en 'failed' y deja de seleccionarse: se
 * convierte en un buzón de correo muerto que se ve de un vistazo consultando la
 * tabla, en vez de en un reintento eterno contra un correo que no existe.
 */ const MAX_ATTEMPTS = 5;
/**
 * Resend admite 2 peticiones por segundo. Se envía en serie con una pausa algo
 * mayor que el mínimo: con lotes de 25 el barrido tarda unos segundos y no hay
 * ninguna prisa por acabar antes.
 */ const PAUSA_MS = 600;
const dormir = (ms)=>new Promise((r)=>setTimeout(r, ms));
/**
 * Comparacion en tiempo constante.
 *
 * Se compara TODO el largo pase lo que pase: un `===` normal se para en el
 * primer byte distinto, y cuanto tarda en pararse dice cuantos acerto quien
 * prueba. La diferencia de longitud si se filtra —no hay forma de esconderla—,
 * pero no ayuda a adivinar el contenido.
 */ function secretosIguales(a, b) {
  if (a.length !== b.length) return false;
  let diferencia = 0;
  for(let i = 0; i < a.length; i += 1)diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferencia === 0;
}
/**
 * Un nombre puede traer `&`, `<` o `>` —o alguien puede haberse registrado con
 * algo peor—, y aquí se está construyendo HTML. Se escapa antes de insertarlo:
 * si no, un nombre raro rompe la maquetación en el mejor caso.
 */ function escaparHtml(texto) {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
/**
 * El correo, con el nombre puesto.
 *
 * La plantilla dice «Hola {{nombre}},». Cuando hay nombre queda «Hola Ana,»; y
 * cuando no lo hay se borra también el espacio de delante, así que queda
 * «Hola,», que se lee como un saludo normal. Lo que nunca puede pasar es que
 * salga el marcador tal cual.
 *
 * El reemplazo usa una función y no una cadena a propósito: `String.replace`
 * interpreta `$&` y compañía dentro del texto de sustitución, y el nombre de una
 * persona no debe poder comportarse como un patrón.
 */ function cuerpo(nombre) {
  const limpio = String(nombre ?? '').trim();
  const saludo = limpio ? ` ${escaparHtml(limpio)}` : '';
  return PLANTILLA_BIENVENIDA.replace(' {{nombre}}', ()=>saludo);
}
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') return new Response('ok', {
    headers: cors
  });
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const resendKey = Deno.env.get('RESEND_API_KEY');
    // Se recorta: un secreto pegado a mano puede arrastrar un salto de línea, y
    // ese detalle invisible no debe decidir si el worker arranca o no.
    const workerSecret = Deno.env.get('CAPTAIN_WELCOME_WORKER_SECRET')?.trim();
    if (!url || !serviceKey) return json({
      error: 'MISSING_PLATFORM_ENV'
    }, 500);
    // Sin secreto NO se abre la puerta: se cierra. Un worker que se quedara sin
    // su secreto y siguiera aceptando llamadas seria peor que uno caido.
    if (!workerSecret) return json({
      error: 'MISSING_WORKER_SECRET'
    }, 500);
    // Y sin clave de Resend no hay nada que hacer: mejor decirlo que reclamar
    // filas para luego fallar una por una.
    if (!resendKey) return json({
      error: 'MISSING_RESEND_API_KEY'
    }, 500);
    // La autorizacion de verdad. El `Authorization` ya lo ha mirado la
    // plataforma; esto es lo que distingue al cron de cualquier otro que tenga
    // sesion en AlGrass.
    if (!secretosIguales(req.headers.get('x-worker-secret')?.trim() ?? '', workerSecret)) {
      return json({
        error: 'FORBIDDEN'
      }, 403);
    }
    const admin = createClient(url, serviceKey, {
      auth: {
        persistSession: false
      }
    });
    // 0) Lo primero, antes de mirar nada: devolver a la cola las reclamaciones
    //    colgadas. Así entran en la selección de este mismo barrido en vez de
    //    esperar al siguiente. El umbral vive en la base, con su DEFAULT, para
    //    poder ajustarlo sin volver a desplegar esto.
    const { data: recuperadas, error: requeueErr } = await admin.rpc('requeue_stuck_captain_welcome_emails');
    if (requeueErr) return json({
      error: 'REQUEUE_FAILED',
      detail: requeueErr.message
    }, 500);
    // 1) Candidatas. SOLO pending y failed: 'skipped' y 'sent' no se miran
    //    siquiera, y las que agotaron los intentos quedan fuera.
    const { data: candidatas, error: leerErr } = await admin.from('captain_welcome_emails').select('id, user_id, attempts').in('status', [
      'pending',
      'failed'
    ]).lt('attempts', MAX_ATTEMPTS).order('created_at', {
      ascending: true
    }).limit(BATCH);
    if (leerErr) return json({
      error: 'QUEUE_READ_FAILED',
      detail: leerErr.message
    }, 500);
    const pendientes = candidatas ?? [];
    if (!pendientes.length) {
      return json({
        ok: true,
        requeued: recuperadas ?? 0,
        claimed: 0,
        sent: 0,
        failed: 0
      }, 200);
    }
    let enviados = 0;
    let fallidos = 0;
    let reclamadas = 0;
    let primero = true;
    for (const fila of pendientes){
      // 2) Reclamar. Devuelve la fila si era suya y nada si otro barrido se
      //    adelantó o si entre la selección y ahora agotó los intentos.
      const { data: reclamadaRaw, error: claimErr } = await admin.rpc('claim_captain_welcome_email', {
        p_id: fila.id,
        p_max_attempts: MAX_ATTEMPTS
      });
      if (claimErr) continue;
      const reclamada = Array.isArray(reclamadaRaw) ? reclamadaRaw[0] : reclamadaRaw;
      if (!reclamada) continue; // se la llevó otro, o ya cambió de estado
      reclamadas += 1;
      // A partir de aquí la fila está en 'sending' y es NUESTRA: pase lo que
      // pase hay que dejarla en 'sent' o en 'failed'.
      try {
        // 3) A quién se le escribe. Service-role, así que no hay RLS de por
        //    medio; se piden solo los tres campos que hacen falta.
        const { data: usuario, error: userErr } = await admin.from('users').select('full_name, email, deleted_at').eq('id', fila.user_id).maybeSingle();
        if (userErr) throw new Error(`USER_LOOKUP_FAILED: ${userErr.message}`);
        if (!usuario) throw new Error('USER_NOT_FOUND');
        if (usuario.deleted_at) throw new Error('USER_DELETED');
        const destino = String(usuario.email ?? '').trim();
        if (!destino) throw new Error('USER_HAS_NO_EMAIL');
        // Entre envíos, no antes del primero: no tiene sentido esperar para
        // mandar uno solo.
        if (!primero) await dormir(PAUSA_MS);
        primero = false;
        // 4) Resend. La clave de idempotencia usa el formato que ellos
        //    recomiendan, <evento>/<entidad>, con el id de la fila de la cola:
        //    es único para siempre y no se repite entre personas.
        const respuesta = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': `captain-welcome/${fila.id}`
          },
          body: JSON.stringify({
            from: FROM,
            to: destino,
            subject: '¡Ya eres Capitán AlGrass! ⚽',
            html: cuerpo(usuario.full_name ?? '')
          })
        });
        const texto = await respuesta.text();
        if (!respuesta.ok) {
          // 409 con `concurrent_idempotent_requests` significa que hay otra
          // petición idéntica en vuelo. No es un fallo del correo: se deja en
          // 'failed' y el siguiente barrido lo resuelve, que es justo lo que
          // Resend recomienda.
          throw new Error(`RESEND_${respuesta.status}: ${texto.slice(0, 400)}`);
        }
        // 5) Entregado a Resend. Se anota la fila con un CAS sobre 'sending':
        //    si alguien la hubiera cambiado por debajo, no se pisa.
        const { error: marcaErr } = await admin.from('captain_welcome_emails').update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          // Fuera la hora de la reclamación: la fila ya no está en vuelo, y
          // dejarla puesta haría que una 'sent' pareciera reclamada.
          claimed_at: null,
          last_error: null
        }).eq('id', fila.id).eq('status', 'sending');
        if (marcaErr) throw new Error(`MARK_SENT_FAILED: ${marcaErr.message}`);
        enviados += 1;
      } catch (e) {
        // Cualquier cosa que salga mal deja la fila en 'failed' con el motivo a
        // la vista. `attempts` ya se incrementó al reclamarla, así que un fallo
        // permanente acaba agotándose solo en vez de reintentarse sin fin.
        fallidos += 1;
        const motivo = String(e?.message ?? e).slice(0, 1000);
        await admin.from('captain_welcome_emails').update({
          status: 'failed',
          claimed_at: null,
          last_error: motivo
        }).eq('id', fila.id).eq('status', 'sending');
      }
    }
    return json({
      ok: true,
      requeued: recuperadas ?? 0,
      claimed: reclamadas,
      sent: enviados,
      failed: fallidos
    }, 200);
  } catch (e) {
    return json({
      error: 'UNEXPECTED',
      detail: String(e?.message ?? e)
    }, 500);
  }
});
