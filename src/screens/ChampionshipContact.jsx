import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { BLUE, TEXT, SUB, HAIR, ORANGE, SOFT, GREEN, DANGER } from '../constants';
import { CURRENT_USER_NAME } from '../data/championshipTeamsMock';
// Catálogos existentes (no se duplican): formatos y distritos.
import { FORMATS, DISTRICTS } from '../data/championshipFormats';
// Mismo patrón de prefijo telefónico de Perfil (auditado y reutilizado sin tocar Profile).
import { detectPrefix } from '../utils/profileData';
// Selector de distritos (multiselección) reutilizado de Partidos.
import DistrictSheet from '../components/DistrictSheet';

// Mismo session-state que ChampionshipView. Sin persistencia real (mock, sin Supabase).
const CV_KEY = 'championship_view_state';
function readCV() { try { return JSON.parse(sessionStorage.getItem(CV_KEY)); } catch { return null; } }
function writeCV(o) { try { sessionStorage.setItem(CV_KEY, JSON.stringify(o)); } catch {} }
function readCity() { try { return JSON.parse(localStorage.getItem('pichanga_profile'))?.city || 'Lima'; } catch { return 'Lima'; } }

const CARD = { background: '#fff', borderRadius: 18, padding: '16px 16px', marginBottom: 12 };
const inputStyle = { width: '100%', boxSizing: 'border-box', border: `1.5px solid ${HAIR}`, background: '#fff', height: 44, padding: '0 12px', fontSize: 16, color: TEXT, fontFamily: 'inherit', outline: 'none', borderRadius: 12, WebkitTapHighlightColor: 'transparent' };
const selectStyle = { ...inputStyle, padding: '0 34px 0 12px', appearance: 'none', WebkitAppearance: 'none', background: `#fff url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23999' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 12px center` };

function Lbl({ children, required, optional }) {
  return (
    <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: SUB, marginBottom: 5 }}>
      {children}{required ? <span style={{ color: DANGER }}> *</span> : optional ? <span style={{ color: SUB, fontWeight: 500 }}> (opcional)</span> : null}
    </label>
  );
}

function Field({ label, value, onChange, error, required, optional, type = 'text', textarea = false, placeholder }) {
  const st = { ...inputStyle, borderColor: error ? DANGER : HAIR };
  return (
    <div style={{ marginBottom: 12 }}>
      <Lbl required={required} optional={optional}>{label}</Lbl>
      {textarea
        ? <textarea value={value} onChange={onChange} rows={3} placeholder={placeholder} style={{ ...st, height: 'auto', minHeight: 84, padding: '10px 12px', resize: 'vertical' }} />
        : <input type={type} value={value} onChange={onChange} placeholder={placeholder} style={st} />}
    </div>
  );
}

function ctaStyle(enabled) {
  return {
    pointerEvents: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: 54, borderRadius: 18, border: 'none',
    background: enabled ? ORANGE : '#E4E4EA', color: enabled ? '#1B1B1F' : '#9A9AA2',
    cursor: enabled ? 'pointer' : 'not-allowed', fontFamily: 'inherit', fontSize: 16, fontWeight: 800, letterSpacing: -0.2,
    boxShadow: enabled ? '0 6px 18px rgba(245,165,36,0.40)' : 'none', WebkitTapHighlightColor: 'transparent', outline: 'none',
  };
}

const deleteBtn = { width: '100%', height: 46, borderRadius: 14, border: '1px solid #F3C0C0', background: '#fff', color: DANGER, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14.5, fontWeight: 700, WebkitTapHighlightColor: 'transparent', outline: 'none' };

export default function ChampionshipContact() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const nav = location.state || {};
  const summary = nav.summary || {};
  const organizeState = nav.organizeState || null;
  const championshipName = nav.championshipName || summary.name || 'Copa AlGrass';

  // Solicitud EXISTENTE (abierta desde Perfil). En ese caso la pantalla comunica PRIMERO "Solicitud enviada".
  const existing = nav.existingRequest ? (readCV()?.contactRequest || null) : null;
  const [formOpen, setFormOpen] = useState(false); // solo aplica al modo existente (editar información)

  const isLiga = summary.mode === 'liga';
  const formatPending = !!summary.contactMe;
  const venuePending = !!summary.courtCustom || !summary.venueName;
  const city = existing?.city || readCity();

  // ── Valores iniciales (prefiere los de la solicitud existente) ──
  const initDistricts = existing?.districts ? [...existing.districts] : (Array.isArray(organizeState?.districts) ? [...organizeState.districts] : []);
  const initFormat = existing ? (existing.format || '') : ((!formatPending && FORMATS.includes(summary.formatLabel)) ? summary.formatLabel : '');
  const leagueEst = summary.leagueEstimate || null;
  const initQty = existing?.participantEstimate?.quantity != null ? String(existing.participantEstimate.quantity)
    : (leagueEst?.quantity != null ? String(leagueEst.quantity) : (summary.group?.min != null ? String(summary.group.min) : ''));
  const initType = existing?.participantEstimate?.type || leagueEst?.type || 'teams';
  const initDurOpts = initFormat === '11v11' ? [70, 80, 90] : [30, 40, 50, 60];
  const md = existing?.matchDuration ?? null;
  const initMatchSel = md == null ? '' : (initDurOpts.includes(md) ? String(md) : 'custom');
  const initMatchCustom = (md != null && !initDurOpts.includes(md)) ? String(md) : '';

  const [districts, setDistricts] = useState(initDistricts);
  const [districtSheetOpen, setDistrictSheetOpen] = useState(false);
  const toggleDistrict = (d) => setDistricts(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
  const [tentativeDate, setTentativeDate] = useState(existing?.tentativeDate || '');
  const [startDate, setStartDate] = useState(existing?.tentativeStartDate || '');
  const [endDate, setEndDate] = useState(existing?.tentativeEndDate || '');
  const [matchDuration, setMatchDuration] = useState(initMatchSel);
  const [matchDurationCustom, setMatchDurationCustom] = useState(initMatchCustom);
  const [format, setFormat] = useState(initFormat);

  const durationOptions = format === '11v11' ? [70, 80, 90] : [30, 40, 50, 60];
  const effMatchDuration = matchDuration === 'custom'
    ? (matchDurationCustom ? Number(matchDurationCustom) : null)
    : (matchDuration ? Number(matchDuration) : null);
  const onFormatChange = (v) => { setFormat(v); if (matchDuration !== 'custom') setMatchDuration(''); };
  const [estimateQty, setEstimateQty] = useState(initQty);
  const [estimateType, setEstimateType] = useState(initType);

  // ── Datos de contacto ──
  const [name, setName] = useState(existing?.contactName || CURRENT_USER_NAME);
  const [email, setEmail] = useState(existing?.email || user?.email || '');
  const [prefixInput, setPrefixInput] = useState(existing?.phoneCountryCode ? existing.phoneCountryCode.replace(/^\+/, '') : '51');
  const [phone, setPhone] = useState(existing?.contactPhone || '');
  const [company, setCompany] = useState(existing?.company || '');
  const [jobTitle, setJobTitle] = useState(existing?.jobTitle || '');
  const [message, setMessage] = useState(existing?.message || '');
  const [done, setDone] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const onPhone = (v) => { const digits = v.replace(/\D/g, ''); const p = detectPrefix(prefixInput); setPhone(digits.slice(0, p?.exact ?? 15)); };

  const nameOk = name.trim().length > 0;
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const phoneDigits = phone.replace(/\D/g, '');
  const prefixInfo = detectPrefix(prefixInput);
  const phoneOk = prefixInfo?.exact ? phoneDigits.length === prefixInfo.exact : phoneDigits.length >= 7;
  const canSubmit = nameOk && emailOk && phoneOk; // solo Nombre/Email/Celular son obligatorios

  const buildFields = () => ({
    championshipName,
    contactName: name.trim(),
    email: email.trim(),
    phoneCountryCode: '+' + prefixInput,
    contactPhone: phone.trim(),
    company: company.trim() || null,
    jobTitle: jobTitle.trim() || null,
    message: message.trim() || null,
    city,
    districts: districts.length ? districts : null,
    ...(isLiga
      ? { tentativeStartDate: startDate || null, tentativeEndDate: endDate || null, matchDuration: effMatchDuration }
      : { tentativeDate: tentativeDate || null }),
    format: format || null,
    participantEstimate: { type: estimateType, quantity: estimateQty ? Number(estimateQty) : null },
  });

  const submit = () => {
    if (!canSubmit) return;
    const cv = readCV() || {};
    cv.contactRequest = {
      ...buildFields(),
      originalSummary: summary,
      originalOrganizeState: organizeState,
      formatPending, venuePending,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    writeCV(cv);
    // Navegar YA a Profile; la confirmación aparece SOBRE Profile (replace → Back no vuelve a Contact).
    navigate('/profile', { replace: true, state: { champConfirm: 'request' } });
  };

  const save = () => {
    if (!canSubmit) return;
    const cv = readCV() || {};
    const prev = cv.contactRequest || {};
    cv.contactRequest = { ...prev, ...buildFields(), status: 'pending' }; // conserva original/createdAt/status
    writeCV(cv);
    setFormOpen(false);
  };

  // Cancelar edición → restaurar campos desde lo guardado y recoger el formulario (permanece en pantalla).
  const cancelEdit = () => {
    const req = readCV()?.contactRequest || {};
    setName(req.contactName || CURRENT_USER_NAME);
    setEmail(req.email || user?.email || '');
    setPrefixInput(req.phoneCountryCode ? req.phoneCountryCode.replace(/^\+/, '') : '51');
    setPhone(req.contactPhone || '');
    setCompany(req.company || '');
    setJobTitle(req.jobTitle || '');
    setMessage(req.message || '');
    setDistricts(req.districts ? [...req.districts] : []);
    setTentativeDate(req.tentativeDate || '');
    setStartDate(req.tentativeStartDate || '');
    setEndDate(req.tentativeEndDate || '');
    setFormat(req.format || '');
    const opts = (req.format === '11v11') ? [70, 80, 90] : [30, 40, 50, 60];
    const m = req.matchDuration ?? null;
    setMatchDuration(m == null ? '' : (opts.includes(m) ? String(m) : 'custom'));
    setMatchDurationCustom((m != null && !opts.includes(m)) ? String(m) : '');
    setEstimateQty(req.participantEstimate?.quantity != null ? String(req.participantEstimate.quantity) : '');
    setEstimateType(req.participantEstimate?.type || 'teams');
    setFormOpen(false);
  };

  const doDelete = () => {
    const cv = readCV() || {};
    delete cv.contactRequest; // no toca cv.championship
    writeCV(cv);
    navigate('/profile');
  };

  // ── Formulario (compartido): "Tu campeonato" (opcional) + "Datos de contacto" ──
  const formCards = (
    <>
      <div style={CARD}>
        <div style={{ fontSize: 13, fontWeight: 800, color: TEXT, letterSpacing: -0.1 }}>Tu campeonato<span style={{ color: SUB, fontWeight: 500 }}> (opcional)</span></div>
        <div style={{ fontSize: 12.5, color: SUB, lineHeight: 1.45, margin: '3px 0 14px' }}>Si ya tienes una idea, cuéntanos algunos detalles.</div>

        <div style={{ marginBottom: 12 }}>
          <Lbl>Ciudad</Lbl>
          <div style={{ ...inputStyle, background: SOFT, border: `1px solid ${HAIR}`, display: 'flex', alignItems: 'center', color: TEXT }}>{city}</div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <Lbl optional>Distrito</Lbl>
          <button onClick={() => setDistrictSheetOpen(true)} style={{ ...selectStyle, textAlign: 'left', cursor: 'pointer', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: districts.length ? TEXT : SUB }}>
            {districts.length ? districts.join(', ') : 'Selecciona distritos'}
          </button>
        </div>

        {isLiga ? (
          <>
            <div style={{ marginBottom: 12 }}>
              <Lbl optional>Fecha tentativa de inicio</Lbl>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <Lbl optional>Fecha tentativa de fin</Lbl>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={inputStyle} />
            </div>
          </>
        ) : (
          <div style={{ marginBottom: 12 }}>
            <Lbl optional>Fecha tentativa</Lbl>
            <input type="date" value={tentativeDate} onChange={e => setTentativeDate(e.target.value)} style={inputStyle} />
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <Lbl optional>Formato</Lbl>
          <select value={format} onChange={e => onFormatChange(e.target.value)} style={selectStyle}>
            <option value="">Por definir</option>
            {FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: isLiga ? 12 : 0 }}>
          <Lbl optional>N.º de equipos o personas</Lbl>
          <div style={{ display: 'flex', gap: 8 }}>
            <input inputMode="numeric" value={estimateQty} onChange={e => setEstimateQty(e.target.value.replace(/\D/g, '').slice(0, 3))} placeholder="Ej. 8" style={{ ...inputStyle, flex: 1 }} />
            <select value={estimateType} onChange={e => setEstimateType(e.target.value)} style={{ ...selectStyle, flex: '0 0 130px' }}>
              <option value="teams">equipos</option>
              <option value="people">personas</option>
            </select>
          </div>
        </div>

        {isLiga && (
          <div>
            <Lbl optional>Tiempo de partido</Lbl>
            <select value={matchDuration} onChange={e => setMatchDuration(e.target.value)} style={selectStyle}>
              <option value="">Selecciona una duración</option>
              {durationOptions.map(m => <option key={m} value={m}>{m} minutos</option>)}
              <option value="custom">Personalizar…</option>
            </select>
            {matchDuration === 'custom' && (
              <input inputMode="numeric" value={matchDurationCustom} onChange={e => setMatchDurationCustom(e.target.value.replace(/\D/g, '').slice(0, 3))} placeholder="Minutos" style={{ ...inputStyle, marginTop: 8 }} />
            )}
          </div>
        )}
      </div>

      <div style={CARD}>
        <div style={{ fontSize: 13, fontWeight: 800, color: TEXT, letterSpacing: -0.1, marginBottom: 12 }}>Datos de contacto</div>

        <Field label="Nombre" required value={name} onChange={e => setName(e.target.value)} error={name.length > 0 && !nameOk} placeholder="Nombre completo" />
        <Field label="Email" required type="email" value={email} onChange={e => setEmail(e.target.value)} error={email.length > 0 && !emailOk} placeholder="tucorreo@ejemplo.com" />

        <div style={{ marginBottom: 12 }}>
          <Lbl required>Celular de contacto</Lbl>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', height: 44, borderRadius: 12, border: `1.5px solid ${HAIR}`, background: '#fff', padding: '0 10px', flexShrink: 0 }}>
              <span style={{ fontSize: 16, color: SUB }}>+</span>
              <input value={prefixInput} onChange={e => setPrefixInput(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" style={{ width: 38, height: '100%', border: 'none', background: 'transparent', outline: 'none', fontSize: 16, color: TEXT, fontFamily: 'inherit' }} />
            </div>
            <input value={phone} onChange={e => onPhone(e.target.value)} inputMode="numeric" placeholder="999 999 999" style={{ ...inputStyle, flex: 1, borderColor: phone.length > 0 && !phoneOk ? DANGER : HAIR }} />
          </div>
        </div>

        <Field label="Empresa" optional value={company} onChange={e => setCompany(e.target.value)} placeholder="Nombre de tu empresa" />
        <Field label="Cargo" optional value={jobTitle} onChange={e => setJobTitle(e.target.value)} placeholder="Ej. RRHH, Marketing, Administración" />
        <Field label="Cuéntanos qué necesitas" optional textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Escríbenos cualquier detalle adicional" />
      </div>
    </>
  );

  // Bloque de éxito (solicitud ya enviada) — permanece SIEMPRE visible en el modo existente.
  const sentBlock = (
    <div style={{ textAlign: 'center', padding: '10px 8px 4px' }}>
      <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#D7F0DD', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke={GREEN} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: TEXT, letterSpacing: -0.3 }}>Solicitud enviada</div>
      <div style={{ fontSize: 14, color: SUB, lineHeight: 1.5, marginTop: 6, maxWidth: 340, marginLeft: 'auto', marginRight: 'auto' }}>Nos pondremos en contacto contigo para organizar tu campeonato.</div>
      <div style={{ fontSize: 12.5, color: SUB, lineHeight: 1.5, marginTop: 6, maxWidth: 340, marginLeft: 'auto', marginRight: 'auto' }}>Te contactaremos a través de los datos proporcionados.</div>
    </div>
  );

  return (
    <div className="screen-shell" style={{ display: 'flex', flexDirection: 'column', background: SOFT, overflow: 'hidden' }}>
      <div style={{ background: BLUE, paddingTop: 'calc(env(safe-area-inset-top) + 9px)', paddingBottom: 9, paddingLeft: 8, paddingRight: 12, flexShrink: 0 }}>
        <div style={{ height: 26, display: 'flex', alignItems: 'center', position: 'relative' }}>
          <button onClick={() => navigate(-1)} style={{ position: 'absolute', left: 0, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M15 5l-7 7 7 7" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <div style={{ flex: 1, textAlign: 'center', color: '#fff', fontSize: 17, fontWeight: 600, letterSpacing: -0.2 }}>Solicitud de campeonato</div>
        </div>
      </div>

      {done ? (
        /* Confirmación tras ENVIAR (flujo NEW) */
        <div className="no-sb" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '24px 28px calc(28px + env(safe-area-inset-bottom))' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#D7F0DD', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke={GREEN} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: TEXT, marginBottom: 8, letterSpacing: -0.3 }}>Solicitud enviada</div>
          <div style={{ fontSize: 14.5, color: SUB, lineHeight: 1.5, maxWidth: 320 }}>Nos pondremos en contacto contigo para organizar tu campeonato.</div>
          <div style={{ fontSize: 13, color: SUB, lineHeight: 1.5, maxWidth: 320, marginTop: 8 }}>Puedes revisar o actualizar tu solicitud desde Próximos eventos.</div>
          <button onClick={() => navigate('/profile')} style={{ marginTop: 26, width: '100%', maxWidth: 320, height: 50, borderRadius: 14, background: BLUE, color: '#fff', border: 'none', cursor: 'pointer', fontSize: 15, fontWeight: 700, fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>Continuar</button>
        </div>
      ) : existing ? (
        /* SOLICITUD EXISTENTE — "Solicitud enviada" arriba + formulario colapsable + eliminar */
        <div className="no-sb" style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '16px 16px calc(28px + env(safe-area-inset-bottom))' }}>
          {sentBlock}

          {!formOpen ? (
            <button onClick={() => setFormOpen(true)} className="pressable" style={{ marginTop: 18, width: '100%', height: 48, borderRadius: 14, border: `1.5px solid ${HAIR}`, background: '#fff', color: TEXT, cursor: 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>Editar información proporcionada</button>
          ) : (
            <div style={{ marginTop: 18 }}>
              {formCards}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button onClick={save} disabled={!canSubmit} className={canSubmit ? 'pressable' : undefined} style={{ ...ctaStyle(canSubmit), height: 50, borderRadius: 14 }}>Guardar cambios</button>
                <button onClick={cancelEdit} className="pressable" style={{ width: '100%', height: 50, borderRadius: 14, border: `1.5px solid ${HAIR}`, background: '#fff', color: TEXT, cursor: 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>Cancelar</button>
              </div>
            </div>
          )}

          {/* Eliminar solicitud — SIEMPRE visible (formulario abierto o cerrado) */}
          <button onClick={() => setConfirmDelete(true)} className="pressable" style={{ ...deleteBtn, marginTop: 18 }}>Eliminar solicitud</button>
        </div>
      ) : (
        /* SOLICITUD NUEVA — formulario + Enviar */
        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          <div className="no-sb" style={{ position: 'absolute', inset: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '16px 16px calc(96px + env(safe-area-inset-bottom))' }}>
            <div style={CARD}>
              <div style={{ fontSize: 17, fontWeight: 700, color: TEXT, letterSpacing: -0.3, lineHeight: 1.3 }}>Te ayudamos a organizarlo</div>
              <div style={{ fontSize: 14, color: SUB, lineHeight: 1.5, marginTop: 8 }}>Déjanos tus datos y nos pondremos en contacto contigo para completar los detalles de tu campeonato.</div>
            </div>
            {formCards}
          </div>
          <div style={{ position: 'absolute', left: 16, right: 16, bottom: 'calc(env(safe-area-inset-bottom) + 12px)', pointerEvents: 'none' }}>
            <button onClick={submit} disabled={!canSubmit} className={canSubmit ? 'pressable' : undefined} style={ctaStyle(canSubmit)}>Enviar solicitud</button>
          </div>
        </div>
      )}

      {/* Overlays (comunes) */}
      {districtSheetOpen && (
        <DistrictSheet city={city} districts={DISTRICTS} selected={districts} onToggle={toggleDistrict} onClear={() => setDistricts([])} onClose={() => setDistrictSheetOpen(false)} />
      )}
      {confirmDelete && (
        <div className="sheet-overlay" onClick={() => setConfirmDelete(false)} style={{ position: 'fixed', inset: 0, zIndex: 250, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', background: 'rgba(0,0,0,0.35)', padding: '0 16px calc(24px + env(safe-area-inset-bottom))' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: '#fff', borderRadius: 18, padding: 20, boxShadow: '0 12px 40px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: TEXT, letterSpacing: -0.3 }}>¿Eliminar solicitud?</div>
            <div style={{ fontSize: 13.5, color: SUB, lineHeight: 1.5, marginTop: 6 }}>Esta solicitud dejará de aparecer en tus próximos eventos.</div>
            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button onClick={() => setConfirmDelete(false)} className="pressable" style={{ flex: 1, height: 48, borderRadius: 14, border: `1.5px solid ${HAIR}`, background: '#fff', color: TEXT, cursor: 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>Cancelar</button>
              <button onClick={doDelete} className="pressable" style={{ flex: 1, height: 48, borderRadius: 14, border: 'none', background: DANGER, color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>Eliminar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
