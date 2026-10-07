// ══════════════════════════════════════════════════════════════════════════════
// send_welcome — la bienvenida general de AlGrass
// ══════════════════════════════════════════════════════════════════════════════
//
// Lee `public.welcome_emails`, manda por Resend lo que esté pendiente y anota
// el resultado. La llama el cron `welcome-drain` cada 5 minutos.
//
// Es hermana de `send_captain_welcome` y comparte su patrón, pero NO comparte
// nada con ella: otra cola, otras RPC, otro secreto, otro job. Aquello funciona
// y se queda como está.
//
// ── QUIÉN ENTRA EN LA COLA ─────────────────────────────────────────────────
//
// Un disparador sobre `public.users` mete una fila cuando `confirmed_email` pasa
// de NULL a un correo, que es el momento en que la persona confirma SU correo
// dentro de AlGrass. Esta función no decide a quién se escribe: solo vacía lo
// que ya está encolado.
//
// ── A QUÉ CORREO SE ESCRIBE ────────────────────────────────────────────────
//
// A `public.users.confirmed_email`, que es la misma señal que lo encoló. Se lee
// junto con el nombre, en la misma consulta.
//
// NO hay carrera: la fila de la cola la crea un disparador SOBRE `public.users`,
// así que cuando el trabajador llega, esa fila existe y su `confirmed_email` ya
// tiene valor por definición. Eso es lo que desaparece al cambiar la señal:
// antes el disparador vivía en `auth.users` y podía adelantarse a
// `handle_new_user`.
//
// Y NO hay plan B. Si `confirmed_email` viniera vacío —algo que no debería pasar
// nunca— la fila se deja en 'failed' y se reintenta. Escribir a
// `auth.users.email` de rebote sería mandar la bienvenida a un correo que nadie
// ha confirmado, y eso es justo lo que este cambio viene a evitar.
//
// ── AUTORIZACIÓN ─────────────────────────────────────────────────────────────
//
// Dos llaves:
//   1. el `Authorization: Bearer` de la plataforma, que ya mira Supabase;
//   2. `WELCOME_WORKER_SECRET`, en la cabecera `x-worker-secret`. Es lo que
//      distingue al cron de cualquiera que tenga sesión en AlGrass.
//
// Sin el secreto la función NO se abre: se cierra con 500.
//
// ── IDEMPOTENCIA ─────────────────────────────────────────────────────────────
//
//   1. `unique (user_id)` en la cola: una bienvenida por persona y para siempre;
//   2. el claim atómico: dos barridos no pueden llevarse la misma fila;
//   3. la `Idempotency-Key` de Resend, `welcome/<id de la fila>`. Cubre el hueco
//      entre «Resend aceptó» y «se marcó sent» si el proceso muere en medio.
// ══════════════════════════════════════════════════════════════════════════════
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
/** El remitente verificado. El mismo dominio que el resto del correo de AlGrass. */ const FROM = 'AlGrass <noreply@algrass.com>';
/** El asunto. Se cambia aquí y en ningún otro sitio. */ const SUBJECT = 'Bienvenido a AlGrass ⚽';
/** Cuántas filas por invocación. Con el cron cada 5 minutos sobra de largo. */ const BATCH = 25;
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
    const workerSecret = Deno.env.get('WELCOME_WORKER_SECRET')?.trim();
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
    const { data: recuperadas, error: requeueErr } = await admin.rpc('requeue_stuck_welcome_emails');
    if (requeueErr) return json({
      error: 'REQUEUE_FAILED',
      detail: requeueErr.message
    }, 500);
    // 1) Candidatas. SOLO pending y failed: 'skipped' y 'sent' no se miran
    //    siquiera, y las que agotaron los intentos quedan fuera.
    const { data: candidatas, error: leerErr } = await admin.from('welcome_emails').select('id, user_id, attempts').in('status', [
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
      const { data: reclamadaRaw, error: claimErr } = await admin.rpc('claim_welcome_email', {
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
        // 3) A QUIÉN SE LE ESCRIBE. Una sola consulta: el correo confirmado y
        //    el nombre salen de la misma fila de `public.users`, la que disparó
        //    el encolado y que por tanto existe.
        const { data: perfil, error: perfilErr } = await admin.from('users').select('full_name, confirmed_email, deleted_at').eq('id', fila.user_id).maybeSingle();
        if (perfilErr) throw new Error(`PROFILE_LOOKUP_FAILED: ${perfilErr.message}`);
        if (!perfil) throw new Error('PROFILE_NOT_READY');
        if (perfil.deleted_at) throw new Error('USER_DELETED');
        // El correo CONFIRMADO, y ninguno más. Sin plan B: si viniera vacío, la
        // fila se queda en 'failed' y se reintenta. Nunca se escribe a un correo
        // que nadie haya confirmado.
        const destino = String(perfil.confirmed_email ?? '').trim();
        if (!destino) throw new Error('CONFIRMED_EMAIL_MISSING');
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
            'Idempotency-Key': `welcome/${fila.id}`
          },
          body: JSON.stringify({
            from: FROM,
            to: destino,
            subject: SUBJECT,
            html: cuerpo(perfil.full_name ?? '')
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
        const { error: marcaErr } = await admin.from('welcome_emails').update({
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
        await admin.from('welcome_emails').update({
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
