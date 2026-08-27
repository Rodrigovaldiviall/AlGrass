import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { BLUE, TEXT, SUB, HAIR, ORANGE, SOFT, DANGER, GREEN } from '../constants';
// Componentes de campo compartidos con Editar perfil (exportados desde Profile).
import { FieldRow, NationalityPicker, CityPicker } from './Profile';
// Constantes/helpers de perfil (extraídos a un archivo propio para no mezclar exports en Profile).
import { POSITIONS, detectPrefix, MONTH_LABELS } from '../utils/profileData';
// Validación de edad 18+ compartida (misma regla que Editar perfil).
import { maxBirthParts, birthYears, birthMonthsCount, birthDaysCount, clampBirthDay, clampBirthMonth } from '../utils/birthdate';
// MISMO flujo de avatar que Profile (bucket 'avatars', path ${uid}/avatar.webp, compresión, cache-bust).
import { uploadAvatar, getAvatarUrl } from '../utils/avatar';
// Solicitud real de Capitán (tabla captain_requests). NO toca user_roles.
import { createCaptainRequest, fetchMyOpenCaptainRequest, UNIQUE_VIOLATION } from '../services/captainRequestService';
// Roles efectivos (fuente existente: user_roles vía fetchMyGlobalRoles). Solo lectura.
import { useGlobalRoles } from '../hooks/useGlobalRoles';

const iStyle = (locked = false) => ({
  flex: 1, height: 34, borderRadius: 8,
  border: `1px solid ${locked ? 'transparent' : HAIR}`,
  padding: '0 8px', fontSize: 13.5, color: locked ? SUB : TEXT,
  fontFamily: 'inherit', background: locked ? 'transparent' : '#fff',
  outline: 'none', boxSizing: 'border-box',
});
const selStyle = {
  flex: 1, height: 34, borderRadius: 8, border: `1px solid ${HAIR}`, padding: '0 24px 0 8px',
  fontSize: 13.5, color: TEXT, fontFamily: 'inherit',
  background: `#fff url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23999' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 8px center`,
  outline: 'none', boxSizing: 'border-box', appearance: 'none', WebkitAppearance: 'none',
};

export default function CaptainRequest() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const uid = user?.id ?? null;
  // Rol efectivo AUTORITATIVO (captain/captain_gold) desde el sistema existente de roles.
  const { isCaptain, ready: rolesReady } = useGlobalRoles();

  const [ready, setReady]       = useState(() => !(supabase && user?.id));
  const [email, setEmail]       = useState(user?.email || '');
  const [fullName, setFullName] = useState('');
  const [prefixInput, setPrefixInput] = useState('51');
  const [phone, setPhone]       = useState('');
  // Domicilio (independiente de users.city): address_city / address_line / district.
  const [addressCity, setAddressCity] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [district, setDistrict] = useState('');
  const [gender, setGender]     = useState('');
  const [positions, setPositions] = useState([]);
  const [birthDay, setBirthDay]     = useState(null);
  const [birthMonth, setBirthMonth] = useState(null);
  const [birthYear, setBirthYear]   = useState(null);
  const [nationality, setNationality] = useState('');
  const [occupation, setOccupation]   = useState('');
  // Foto de perfil: MISMAS columnas/Storage que Profile (avatar_path + avatar_updated_at).
  const [avatarPath, setAvatarPath]     = useState(null);
  const [avatarVersion, setAvatarVersion] = useState(null);
  const [photoDataUrl, setPhotoDataUrl] = useState(null); // preview local inmediato mientras sube
  const [avatarUploading, setAvatarUploading] = useState(false);
  // Tamaño de grupo: SOLO estado local (no se persiste en public.users; irá a captain_requests en Fase 2).
  const [groupSize, setGroupSize]   = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice]     = useState(null); // { text, error }
  const [hasOpenRequest, setHasOpenRequest] = useState(null); // null=comprobando · true=en revisión · false=puede solicitar
  const [submitted, setSubmitted] = useState(false);          // solicitud enviada en esta sesión

  const max = maxBirthParts();

  // Carga inicial desde public.users (MISMA fuente de datos que Editar perfil): los datos
  // que ya existen aparecen precargados; el usuario solo completa/corrige lo que falta.
  // Se hace en DOS selects: (1) columnas de perfil que SIEMPRE existen — esta define `ready`;
  // (2) columnas de domicilio, que pueden no existir hasta correr la migración → tolerante,
  // no debe tumbar la hidratación del resto (causa del bug anterior: un solo select con
  // address_* inexistentes fallaba entero y no cargaba ningún campo).
  // NOTA: NO se lee users.city (esa es la ciudad operativa del jugador, otro concepto).
  useEffect(() => {
    if (!supabase || !uid) { setHasOpenRequest(false); return; } // ready ya es true por el inicializador
    let cancelled = false;
    // ¿Ya tiene una solicitud abierta? Si sí, se muestra "Solicitud en revisión" en vez del form.
    fetchMyOpenCaptainRequest(uid).then(({ open }) => { if (!cancelled) setHasOpenRequest(open); });
    supabase.from('users')
      .select('full_name, email, sex, preferred_position, phone, nationality, occupation, birth_date, avatar_path, avatar_updated_at')
      .eq('id', uid).single()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (!error && data) {
          if (data.email)        setEmail(data.email);
          if (data.full_name)    setFullName(data.full_name);
          if (data.phone)        setPhone(String(data.phone));
          if (data.sex)          setGender(data.sex);
          if (data.preferred_position?.length) setPositions(data.preferred_position);
          if (data.nationality)  setNationality(data.nationality);
          if (data.occupation)   setOccupation(data.occupation);
          if (data.avatar_path)  setAvatarPath(data.avatar_path);
          if (data.avatar_updated_at) setAvatarVersion(new Date(data.avatar_updated_at).getTime());
          if (data.birth_date) {
            const [y, m, d] = data.birth_date.split('-').map(Number);
            setBirthYear(y); setBirthMonth(m); setBirthDay(d);
          }
        }
        setReady(true); // el formulario ya está hidratado y editable
      });
    // Domicilio: best-effort (columnas nuevas). Si aún no existen, se ignora sin romper nada.
    supabase.from('users')
      .select('address_city, address_line, district')
      .eq('id', uid).single()
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        if (data.address_city) setAddressCity(data.address_city);
        if (data.address_line) setAddressLine(data.address_line);
        if (data.district)     setDistrict(data.district);
      });
    return () => { cancelled = true; };
  }, [uid]);

  // Persistencia incremental por campo a public.users (misma tabla/RLS self que Editar perfil).
  // GUARD `ready`: no escribe hasta que la hidratación terminó → evita sobrescribir con vacío
  // datos existentes durante la carga. Solo actualiza la columna cambiada. NO escribe
  // users.city ni pichanga_profile. El guardado autoritativo es el de "Solicitar alta".
  const persist = (patch) => {
    if (!supabase || !uid || !ready) return;
    supabase.from('users').update(patch).eq('id', uid)
      .then(({ error }) => { if (error) console.warn('[captain] persist:', error.message); });
  };

  function togglePosition(pos) {
    setPositions(prev => {
      const next = prev.includes(pos) ? prev.filter(p => p !== pos) : [...prev, pos];
      persist({ preferred_position: next.length ? next : null });
      return next;
    });
  }
  const birthPatch = (y, m, d) => (y && m && d)
    ? { birth_date: `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}` } : null;
  function onYear(y) {
    const m = clampBirthMonth(y, birthMonth, max);
    const d = clampBirthDay(y, m, birthDay, max);
    setBirthYear(y); setBirthMonth(m); setBirthDay(d);
    const p = birthPatch(y, m, d); if (p) persist(p);
  }
  function onMonth(m) {
    const d = clampBirthDay(birthYear, m, birthDay, max);
    setBirthMonth(m); setBirthDay(d);
    const p = birthPatch(birthYear, m, d); if (p) persist(p);
  }
  function onDay(d) {
    setBirthDay(d);
    const p = birthPatch(birthYear, birthMonth, d); if (p) persist(p);
  }
  function onPhone(v) {
    const digits = v.replace(/\D/g, '');
    const isPeru = detectPrefix(prefixInput)?.code === '+51';
    setPhone(isPeru ? digits.slice(0, 9) : digits.slice(0, 15));
  }
  // Sube la foto con el MISMO flujo de Profile (compresión + bucket avatars, upsert al mismo
  // path) y persiste avatar_path/avatar_updated_at en public.users → se refleja también en
  // Profile (una sola foto de perfil). Si falla, conserva la foto anterior (avatarPath intacto)
  // y no marca requisito cumplido.
  function handlePhoto(e) {
    const file = e.target.files?.[0];
    if (!file || !supabase || !uid) return;
    const reader = new FileReader();
    reader.onload = ev => setPhotoDataUrl(ev.target.result); // preview local inmediato
    reader.readAsDataURL(file);
    setAvatarUploading(true);
    setNotice(null);
    uploadAvatar(supabase, uid, file)
      .then(path => {
        const ts = Date.now();
        return supabase.from('users')
          .update({ avatar_path: path, avatar_updated_at: new Date(ts).toISOString() })
          .eq('id', uid)
          .then(({ error }) => {
            if (error) throw error;
            setAvatarPath(path); setAvatarVersion(ts); setAvatarUploading(false);
          });
      })
      .catch(err => {
        console.warn('[captain] avatar:', err?.message || err);
        setAvatarUploading(false);
        setPhotoDataUrl(null); // descarta el preview fallido; la foto anterior (avatarPath) sigue válida
        setNotice({ text: 'No pudimos subir la foto. Inténtalo de nuevo.', error: true });
      });
  }

  const availableMonths = MONTH_LABELS.slice(0, birthMonthsCount(birthYear ?? max.year, max));
  const availableDays    = Array.from({ length: birthDaysCount(birthYear ?? max.year, birthMonth, max) }, (_, i) => i + 1);
  const years            = birthYears(max);

  // Requisito de foto = foto de perfil PERSISTIDA (avatarPath), no el preview local.
  const hasPhoto = !!avatarPath;
  const photoSrc = photoDataUrl || getAvatarUrl(supabase, avatarPath, avatarVersion);

  // Habilita "Solicitar alta" solo con TODOS los obligatorios (incluye domicilio, foto y tamaño de
  // grupo), y NO durante la carga inicial, la subida de foto, ni el guardado.
  const complete = !!email && !!fullName.trim() && !!phone.trim()
    && !!addressCity && !!addressLine.trim() && !!district.trim()
    && !!gender && positions.length > 0
    && !!birthDay && !!birthMonth && !!birthYear
    && !!nationality && !!occupation.trim()
    && hasPhoto && !!groupSize;
  const canSubmit = complete && ready && !submitting && !avatarUploading;

  // "Solicitar alta" — responsabilidad 1 (Fase 1): guardado FINAL (snapshot) de los datos
  // actuales en public.users, restringido al usuario autenticado (.eq('id', uid)). Se espera
  // el resultado; solo si el UPDATE termina OK se continúa. group_size NO se guarda aquí
  // (irá a captain_requests en Fase 2). Email NO se toca aquí. `submitting` evita doble envío
  // y carreras con los guardados por-campo (el snapshot final es autoritativo).
  async function onSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setNotice(null);
    const patch = {
      full_name: fullName.trim() || null,
      phone: phone.trim() || null,
      address_city: addressCity || null,
      address_line: addressLine.trim() || null,
      district: district.trim() || null,
      sex: gender || null,
      preferred_position: positions.length ? positions : null,
      birth_date: (birthYear && birthMonth && birthDay)
        ? `${birthYear}-${String(birthMonth).padStart(2, '0')}-${String(birthDay).padStart(2, '0')}` : null,
      nationality: nationality || null,
      occupation: occupation.trim() || null,
    };
    const { error } = await supabase.from('users').update(patch).eq('id', uid);
    if (error) {
      setSubmitting(false);
      setNotice({ text: 'No pudimos guardar tus datos. Inténtalo de nuevo.', error: true }); // sin falso éxito, STOP
      return;
    }
    // Datos guardados OK → crear la solicitud REAL (status 'pending_review', requested_at por BD).
    // group_size va SOLO aquí (nunca a public.users ni user_roles).
    const { error: reqErr } = await createCaptainRequest(uid, groupSize);
    setSubmitting(false);
    if (reqErr) {
      // Índice parcial: ya existe una solicitud abierta (race/otra pestaña/reintento) → no es un
      // error para el usuario: se muestra "Solicitud en revisión". Detección por código Postgres.
      if (reqErr.code === UNIQUE_VIOLATION) { setHasOpenRequest(true); return; }
      setNotice({ text: 'No pudimos enviar tu solicitud. Inténtalo de nuevo.', error: true }); // sin falso éxito
      return;
    }
    // ── Fase siguiente (TODO): correo específico de Capitán + confirmación. NO en 2A. ──────────
    setSubmitted(true); // → pantalla "Solicitud enviada"
  }

  return (
    <div className="screen-shell" style={{ display: 'flex', flexDirection: 'column', background: SOFT, minHeight: '100%' }}>

      {/* Header azul — mismo patrón que "Dueño de cancha": título centrado + X para cerrar.
          Cerrar usa navigate(-1) (semántica "cerrar formulario"): saca CaptainRequest del back
          inmediato → volver desde Settings continúa el historial anterior, no reabre este form. */}
      <div style={{ background: BLUE, paddingTop: 'calc(env(safe-area-inset-top) + 9px)', paddingBottom: 9, paddingLeft: 20, paddingRight: 20, flexShrink: 0 }}>
        <div style={{ height: 44, display: 'flex', alignItems: 'center', position: 'relative' }}>
          <div style={{ position: 'absolute', left: 0, right: 0, textAlign: 'center', pointerEvents: 'none', padding: '0 44px' }}>
            <span style={{ color: '#fff', fontSize: 16, fontWeight: 600, letterSpacing: -0.2 }}>Capitán</span>
          </div>
          <button onClick={() => navigate(-1)} aria-label="Cerrar" style={{ marginLeft: 'auto', width: 36, height: 36, marginRight: -8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M1 1l16 16M17 1L1 17" stroke="#fff" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>
      </div>

      {/* Estados: enviada · en revisión · comprobando · formulario. El header (con X) es común. */}
      {submitted ? (
        <div className="no-sb" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '24px 28px calc(28px + env(safe-area-inset-bottom))' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#EAF8EF', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" fill={GREEN}/><path d="M7 12.5l3.2 3.2L17 8.8" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: TEXT, letterSpacing: -0.3 }}>Solicitud enviada</div>
          <div style={{ marginTop: 8, fontSize: 14.5, color: SUB, lineHeight: 1.5, maxWidth: 320 }}>Recibimos tu solicitud para ser Capitán. La revisaremos y te avisaremos cuando tengamos novedades.</div>
          <button onClick={() => navigate(-1)} style={{ marginTop: 26, width: '100%', maxWidth: 320, height: 50, borderRadius: 14, background: BLUE, color: '#fff', border: 'none', cursor: 'pointer', fontSize: 15, fontWeight: 700, fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>Continuar</button>
        </div>
      ) : (!rolesReady || hasOpenRequest === null) ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', border: '4px solid #EAEAEE', borderTop: `4px solid ${BLUE}`, animation: 'spin 0.9s linear infinite' }} />
        </div>
      ) : isCaptain ? (
        <div className="no-sb" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '24px 28px calc(28px + env(safe-area-inset-bottom))' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#EAF8EF', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" fill={GREEN}/><path d="M7 12.5l3.2 3.2L17 8.8" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: TEXT, letterSpacing: -0.3 }}>¡Ya eres capitán!</div>
          <div style={{ marginTop: 8, fontSize: 14.5, color: SUB, lineHeight: 1.5, maxWidth: 320 }}>Ya tienes acceso a beneficios de capitán. Despreocúpate y juega.</div>
        </div>
      ) : hasOpenRequest === true ? (
        <div className="no-sb" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '24px 28px calc(28px + env(safe-area-inset-bottom))' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: `${BLUE}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke={BLUE} strokeWidth="1.8"/><path d="M12 7.5V12l3 2" stroke={BLUE} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: TEXT, letterSpacing: -0.3 }}>Solicitud en revisión</div>
          <div style={{ marginTop: 8, fontSize: 14.5, color: SUB, lineHeight: 1.5, maxWidth: 320 }}>Ya recibimos tu solicitud para ser Capitán. Te avisaremos cuando tengamos novedades.</div>
        </div>
      ) : (
      <div className="no-sb" style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '16px 16px calc(28px + env(safe-area-inset-bottom))' }}>
        <div style={{ background: '#fff', borderRadius: 18, padding: '18px 16px' }}>

          <div style={{ fontSize: 18, fontWeight: 800, color: TEXT, letterSpacing: -0.3, lineHeight: 1.28 }}>
            ¿Eres el capitán que organiza las pichangas?
          </div>
          <div style={{ fontSize: 14, color: SUB, lineHeight: 1.5, margin: '8px 0 18px' }}>
            Olvídate de armar la lista y chau a estar cobrando. Solicita tu alta para obtener beneficios. Despreocúpate y juega.
          </div>

          {/* 1. Email — solo lectura. La corrección va por el flujo normal de Editar perfil. */}
          <FieldRow label="Email">
            <input value={email} readOnly disabled style={iStyle(true)} />
          </FieldRow>
          <div style={{ fontSize: 12, color: SUB, marginTop: -4, marginBottom: 12, lineHeight: 1.45 }}>
            Si este correo no es correcto, modifícalo desde{' '}
            <span onClick={() => navigate('/profile', { state: { openEdit: true } })} style={{ color: BLUE, fontWeight: 700, cursor: 'pointer' }}>Editar perfil</span>.
          </div>

          {/* 2. Nombres */}
          <FieldRow label="Nombres y Apellidos">
            <input value={fullName} onChange={e => setFullName(e.target.value)} onBlur={() => persist({ full_name: fullName.trim() || null })} placeholder="Nombre completo" style={iStyle()} />
          </FieldRow>

          {/* 3. Celular */}
          <FieldRow label="Número de celular">
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', height: 34, borderRadius: 8, border: `1px solid ${HAIR}`, background: '#fff', padding: '0 6px', flexShrink: 0 }}>
                <span style={{ fontSize: 13.5, color: SUB }}>+</span>
                <input value={prefixInput} onChange={e => setPrefixInput(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" style={{ width: 34, height: '100%', border: 'none', background: 'transparent', outline: 'none', fontSize: 13.5, color: TEXT, fontFamily: 'inherit' }} />
              </div>
              <input value={phone} onChange={e => onPhone(e.target.value)} onBlur={() => persist({ phone: phone.trim() || null })} inputMode="numeric" placeholder="Celular" style={iStyle()} />
            </div>
          </FieldRow>

          {/* 4-6. Domicilio: ciudad de residencia (address_city) / dirección / distrito */}
          <FieldRow label="Ciudad de residencia">
            <CityPicker value={addressCity} onChange={v => { setAddressCity(v); persist({ address_city: v || null }); }} />
          </FieldRow>
          <FieldRow label="Dirección">
            <input value={addressLine} onChange={e => setAddressLine(e.target.value)} onBlur={() => persist({ address_line: addressLine.trim() || null })} placeholder="Calle y número" style={iStyle()} />
          </FieldRow>
          <FieldRow label="Distrito">
            <input value={district} onChange={e => setDistrict(e.target.value)} onBlur={() => persist({ district: district.trim() || null })} placeholder="Distrito" style={iStyle()} />
          </FieldRow>

          {/* 7. Sexo */}
          <FieldRow label="Sexo">
            <select value={gender} onChange={e => { setGender(e.target.value); persist({ sex: e.target.value || null }); }} style={{ ...selStyle, flex: '0 0 110px' }}>
              <option value="" disabled>—</option>
              <option>Hombre</option>
              <option>Mujer</option>
              <option>Otro</option>
            </select>
          </FieldRow>

          {/* 8. Posición */}
          <FieldRow label="Posición de juego">
            <div style={{ display: 'flex', gap: 4 }}>
              {POSITIONS.map(pos => {
                const sel = positions.includes(pos);
                return (
                  <button key={pos} onClick={() => togglePosition(pos)} style={{
                    height: 32, padding: '0 8px', borderRadius: 999,
                    border: `1.5px solid ${sel ? BLUE : HAIR}`, background: sel ? `${BLUE}18` : '#fff',
                    color: sel ? BLUE : TEXT, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    WebkitTapHighlightColor: 'transparent', outline: 'none',
                  }}>{pos}</button>
                );
              })}
            </div>
          </FieldRow>

          {/* 9. Fecha de nacimiento (+18) */}
          <FieldRow label="Fecha de nacimiento (+18)">
            <select value={birthDay ?? ''} onChange={e => { const v = Number(e.target.value); if (v) onDay(v); }} style={{ ...selStyle, flex: '0 0 58px' }}>
              {birthDay == null && <option value="" disabled>—</option>}
              {availableDays.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <select value={birthMonth ?? ''} onChange={e => { const v = Number(e.target.value); if (v) onMonth(v); }} style={{ ...selStyle, flex: '0 0 114px' }}>
              {birthMonth == null && <option value="" disabled>—</option>}
              {availableMonths.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
            <select value={birthYear ?? ''} onChange={e => { const v = Number(e.target.value); if (v) onYear(v); }} style={{ ...selStyle, flex: '0 0 82px' }}>
              {birthYear == null && <option value="" disabled>—</option>}
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </FieldRow>

          {/* 10. Nacionalidad */}
          <FieldRow label="Nacionalidad">
            <NationalityPicker value={nationality} onChange={v => { setNationality(v); persist({ nationality: v || null }); }} />
          </FieldRow>

          {/* 11. Ocupación */}
          <FieldRow label="Ocupación">
            <input value={occupation} onChange={e => setOccupation(e.target.value)} onBlur={() => persist({ occupation: occupation.trim() || null })} placeholder="Ocupación" style={iStyle()} />
          </FieldRow>

          {/* Foto de perfil — pertenece al perfil del usuario (mismo avatar que Profile). */}
          <FieldRow label="Foto de perfil">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: SOFT, border: `1px solid ${HAIR}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {photoSrc
                  ? <img src={photoSrc} alt="Foto de perfil" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="9" r="3.2" stroke={SUB} strokeWidth="1.6"/><path d="M5 19c1.2-3 4-4.5 7-4.5S17.8 16 19 19" stroke={SUB} strokeWidth="1.6" strokeLinecap="round"/></svg>}
              </div>
              <label style={{ color: avatarUploading ? SUB : BLUE, fontWeight: 700, fontSize: 13.5, cursor: avatarUploading ? 'default' : 'pointer' }}>
                {avatarUploading ? 'Subiendo…' : (hasPhoto ? 'Cambiar foto' : 'Agregar foto')}
                <input type="file" accept="image/*" onChange={handlePhoto} disabled={avatarUploading} style={{ display: 'none' }} />
              </label>
            </div>
          </FieldRow>

          {/* 12. Tamaño de grupo — selección única. Solo estado local (Fase 2: captain_requests). */}
          <FieldRow label="¿Cuántas personas suelen ser en tu grupo?">
            <div style={{ display: 'flex', gap: 6 }}>
              {[{ v: '6_plus', label: '6+' }, { v: '12_plus', label: '12+' }, { v: '16_plus', label: '16+' }].map(g => {
                const sel = groupSize === g.v;
                return (
                  <button key={g.v} onClick={() => setGroupSize(g.v)} style={{
                    minWidth: 52, height: 34, padding: '0 12px', borderRadius: 999,
                    border: `1.5px solid ${sel ? BLUE : HAIR}`, background: sel ? `${BLUE}18` : '#fff',
                    color: sel ? BLUE : TEXT, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    WebkitTapHighlightColor: 'transparent', outline: 'none',
                  }}>{g.label}</button>
                );
              })}
            </div>
          </FieldRow>

          <button
            onClick={onSubmit}
            disabled={!canSubmit}
            aria-disabled={!canSubmit}
            style={{
              marginTop: 18, width: '100%', height: 50, borderRadius: 14, border: 'none',
              background: canSubmit ? ORANGE : '#E4E4EA', color: canSubmit ? '#1B1B1F' : '#9A9AA2',
              fontSize: 15, fontWeight: 700, fontFamily: 'inherit',
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              WebkitTapHighlightColor: 'transparent', outline: 'none',
            }}>
            {submitting ? 'Guardando…' : 'Solicitar alta'}
          </button>

          {notice && (
            <div style={{ marginTop: 12, fontSize: 13, color: notice.error ? DANGER : SUB, textAlign: 'center', lineHeight: 1.45 }}>{notice.text}</div>
          )}
        </div>
      </div>
      )}
    </div>
  );
}
