import { useState } from 'react';
import { createPortal } from 'react-dom';
import { BLUE, TEXT, SUB, HAIR, SOFT, GREEN, DANGER } from '../constants';
import { supabase } from '../lib/supabase';

const REASONS = [
  { title: 'Más reservas',          body: 'Conecta tu cancha con jugadores que buscan dónde jugar todos los días.' },
  { title: 'Mayor rentabilidad',    body: 'Reduce horas vacías y aumenta la ocupación de tu negocio.' },
  { title: 'Menos gestión manual',  body: 'Centraliza reservas y consultas en un solo lugar.' },
  { title: 'Mayor visibilidad',     body: 'Llega a más jugadores de tu ciudad cuando buscan dónde jugar.' },
];

function Field({ label, value, onChange, error, optional, type = 'text' }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: SUB, marginBottom: 5 }}>
        {label}{!optional && <span style={{ color: DANGER }}> *</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={onChange}
        style={{
          width: '100%', height: 44, borderRadius: 12, boxSizing: 'border-box',
          border: `1.5px solid ${error ? DANGER : HAIR}`, background: '#fff',
          padding: '0 12px', fontSize: 16, color: TEXT, fontFamily: 'inherit',
          outline: 'none', WebkitTapHighlightColor: 'transparent',
        }}
      />
    </div>
  );
}

export default function VenueLeadScreen({ onClose, defaultCity = '' }) {
  const [form, setForm] = useState({ name: '', email: '', city: defaultCity, district: '', venue_name: '', website: '' });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  function validate() {
    const e = {};
    if (!form.name.trim()) e.name = true;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) e.email = true;
    if (!form.city.trim()) e.city = true;
    if (!form.district.trim()) e.district = true;
    if (!form.venue_name.trim()) e.venue_name = true;
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit() {
    if (submitting) return;
    if (!validate()) return;
    setSubmitting(true);
    const { error } = await supabase.from('venue_leads').insert({
      name:       form.name.trim(),
      email:      form.email.trim(),
      city:       form.city.trim(),
      district:   form.district.trim(),
      venue_name: form.venue_name.trim(),
      website:    form.website.trim() || null,
    });
    setSubmitting(false);
    if (error) { setErrors({ submit: 'No se pudo enviar. Inténtalo de nuevo.' }); return; }
    setDone(true);
  }

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 9000, background: SOFT, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ background: BLUE, paddingTop: 'calc(env(safe-area-inset-top) + 9px)', paddingBottom: 9, paddingLeft: 20, paddingRight: 20, flexShrink: 0 }}>
        <div style={{ height: 44, display: 'flex', alignItems: 'center', position: 'relative' }}>
          <div style={{ position: 'absolute', left: 0, right: 0, textAlign: 'center', pointerEvents: 'none', padding: '0 44px' }}>
            <span style={{ color: '#fff', fontSize: 16, fontWeight: 600, letterSpacing: -0.2 }}>¿Eres dueño de una cancha?</span>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            style={{ marginLeft: 'auto', width: 36, height: 36, marginRight: -8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M1 1l16 16M17 1L1 17" stroke="#fff" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>
      </div>

      {done ? (
        /* Confirmación */
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '24px 28px calc(28px + env(safe-area-inset-bottom))' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#D7F0DD', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke={GREEN} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: TEXT, marginBottom: 8, letterSpacing: -0.3 }}>¡Gracias por contactarnos!</div>
          <div style={{ fontSize: 14.5, color: SUB, lineHeight: 1.5, maxWidth: 320 }}>Nos pondremos en contacto contigo lo más pronto posible.</div>
          <button
            onClick={onClose}
            style={{ marginTop: 26, width: '100%', maxWidth: 320, height: 50, borderRadius: 14, background: BLUE, color: '#fff', border: 'none', cursor: 'pointer', fontSize: 15, fontWeight: 700, fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
            Aceptar
          </button>
        </div>
      ) : (
        /* Bloques A + B */
        <div className="no-sb" style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '16px 16px calc(28px + env(safe-area-inset-bottom))' }}>
          <div className="venue-lead-blocks">

            {/* Bloque A — Datos de contacto */}
            <div className="venue-lead-block" style={{ background: '#fff', borderRadius: 18, padding: '18px 16px' }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: TEXT, letterSpacing: -0.3, lineHeight: 1.3 }}>
                ¿Eres dueño de una cancha de fútbol y quieres generar más rentabilidad?
              </div>
              <div style={{ fontSize: 14, color: SUB, lineHeight: 1.5, margin: '8px 0 16px' }}>
                Déjanos tus datos y nos pondremos en contacto contigo.
              </div>

              <Field label="Nombre"          value={form.name}       onChange={set('name')}       error={errors.name} />
              <Field label="Email"           value={form.email}      onChange={set('email')}      error={errors.email} type="email" />
              <Field label="Ciudad"          value={form.city}       onChange={set('city')}       error={errors.city} />
              <Field label="Distrito"        value={form.district}   onChange={set('district')}   error={errors.district} />
              <Field label="Nombre del local" value={form.venue_name} onChange={set('venue_name')} error={errors.venue_name} />
              <Field label="Website"         value={form.website}    onChange={set('website')}    optional />

              {errors.submit && <div style={{ fontSize: 12.5, color: DANGER, marginBottom: 10 }}>{errors.submit}</div>}

              <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                <button
                  onClick={onClose}
                  style={{ flex: 1, height: 48, borderRadius: 14, background: '#fff', color: TEXT, border: `1.5px solid ${HAIR}`, cursor: 'pointer', fontSize: 15, fontWeight: 600, fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                  Cancelar
                </button>
                <button
                  onClick={submit}
                  disabled={submitting}
                  style={{ flex: 1, height: 48, borderRadius: 14, background: BLUE, color: '#fff', border: 'none', cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.7 : 1, fontSize: 15, fontWeight: 700, fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                  {submitting ? 'Enviando…' : 'Enviar'}
                </button>
              </div>
            </div>

            {/* Bloque B — ¿Por qué AlGrass? */}
            <div className="venue-lead-block" style={{ background: '#fff', borderRadius: 18, padding: '18px 16px' }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: TEXT, letterSpacing: -0.3, marginBottom: 14 }}>
                ¿Por qué AlGrass?
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {REASONS.map((r, i) => (
                  <div key={i} style={{ display: 'flex', gap: 12, padding: '12px 12px', borderRadius: 14, background: SOFT }}>
                    <div style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 8, background: `${BLUE}1A`, color: BLUE, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700 }}>
                      {i + 1}
                    </div>
                    <div>
                      <div style={{ fontSize: 14.5, fontWeight: 700, color: TEXT, marginBottom: 2 }}>{r.title}</div>
                      <div style={{ fontSize: 13, color: SUB, lineHeight: 1.45 }}>{r.body}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
