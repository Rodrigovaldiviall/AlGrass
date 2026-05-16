import { createPortal } from 'react-dom';
import { useState, useEffect } from 'react';
import { useStaff } from '../context/StaffContext';
import { TEXT, SUB, HAIR, SOFT, BLUE, GREEN, DANGER } from '../constants';

function StaffIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <circle cx="8" cy="7" r="3" stroke={BLUE} strokeWidth="1.5"/>
      <path d="M2 18c0-3.3 2.7-6 6-6" stroke={BLUE} strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx="15" cy="12" r="3" stroke={BLUE} strokeWidth="1.5"/>
      <path d="M9 21c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke={BLUE} strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

export default function StaffInviteModal() {
  const { pendingInvites, acceptInvite, rejectInvite, dismissModal } = useStaff();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null); // '<rowId>_accept' | '<rowId>_reject'

  useEffect(() => {
    const t = setTimeout(() => setOpen(true), 20);
    return () => clearTimeout(t);
  }, []);

  function dismiss() {
    setOpen(false);
    setTimeout(() => dismissModal(), 280);
  }

  async function handleAccept(rowId) {
    setBusy(rowId + '_accept');
    await acceptInvite(rowId);
    setBusy(null);
    if (pendingInvites.length === 1) dismiss();
  }

  async function handleReject(rowId) {
    setBusy(rowId + '_reject');
    await rejectInvite(rowId);
    setBusy(null);
    if (pendingInvites.length === 1) dismiss();
  }

  return createPortal(
    <div
      onClick={dismiss}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: open ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0)',
        transition: 'background .22s ease',
        display: 'flex', alignItems: 'flex-end',
      }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', background: '#fff',
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          padding: '8px 20px calc(32px + env(safe-area-inset-bottom))',
          boxShadow: '0 -8px 32px rgba(0,0,0,0.12)',
          transform: open ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform .28s cubic-bezier(0.32,0.72,0,1)',
        }}>

        {/* Handle bar */}
        <div style={{ width: 42, height: 4, borderRadius: 2, background: '#D1D1D6', margin: '12px auto 20px' }} />

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 13, background: '#EEF2FF',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <StaffIcon />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: TEXT, letterSpacing: -0.2 }}>
              {pendingInvites.length === 1
                ? 'Invitación de staff'
                : `${pendingInvites.length} invitaciones de staff`}
            </div>
            <div style={{ fontSize: 13, color: SUB, marginTop: 1 }}>
              Revisa y responde a continuación
            </div>
          </div>
        </div>

        {/* Invitation cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '16px 0' }}>
          {pendingInvites.map(inv => {
            const isBusy = busy?.startsWith(inv.id);
            const dateStr = inv.created_at
              ? new Date(inv.created_at).toLocaleDateString('es-PE', { day: 'numeric', month: 'long' })
              : null;
            return (
              <div
                key={inv.id}
                style={{ border: `1.5px solid ${HAIR}`, borderRadius: 16, padding: '14px 16px', background: SOFT }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: TEXT, marginBottom: 2 }}>
                  {inv.venues?.name ?? 'Venue'} te invitó a formar parte del staff
                </div>
                {dateStr && (
                  <div style={{ fontSize: 12.5, color: SUB, marginBottom: 12 }}>
                    {dateStr}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => !isBusy && handleAccept(inv.id)}
                    style={{
                      flex: 1, height: 40, borderRadius: 12,
                      background: GREEN, color: '#fff',
                      border: 'none', cursor: isBusy ? 'default' : 'pointer',
                      fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
                      opacity: isBusy ? 0.55 : 1, transition: 'opacity .15s',
                      WebkitTapHighlightColor: 'transparent', outline: 'none',
                    }}>
                    {busy === inv.id + '_accept' ? '…' : 'Aceptar'}
                  </button>
                  <button
                    onClick={() => !isBusy && handleReject(inv.id)}
                    style={{
                      flex: 1, height: 40, borderRadius: 12,
                      background: '#fff', color: DANGER,
                      border: `1.5px solid ${DANGER}50`,
                      cursor: isBusy ? 'default' : 'pointer',
                      fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
                      opacity: isBusy ? 0.55 : 1, transition: 'opacity .15s',
                      WebkitTapHighlightColor: 'transparent', outline: 'none',
                    }}>
                    {busy === inv.id + '_reject' ? '…' : 'Rechazar'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Dismiss — invitation stays pending in DB */}
        <button
          onClick={dismiss}
          style={{
            width: '100%', height: 46, borderRadius: 14,
            background: SOFT, color: SUB,
            border: 'none', cursor: 'pointer',
            fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
            WebkitTapHighlightColor: 'transparent', outline: 'none',
          }}>
          Responder más tarde
        </button>
      </div>
    </div>,
    document.body
  );
}
