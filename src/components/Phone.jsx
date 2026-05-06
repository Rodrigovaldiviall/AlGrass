export function StatusBar() {
  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0,
      height: 54, padding: '14px 28px 0',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      color: '#fff', zIndex: 5, pointerEvents: 'none',
    }}>
      <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: -0.2 }}>5:47</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <svg width="18" height="11" viewBox="0 0 18 11">
          <rect x="0" y="7" width="3" height="4" rx="0.6" fill="#fff"/>
          <rect x="4.5" y="5" width="3" height="6" rx="0.6" fill="#fff"/>
          <rect x="9" y="2.5" width="3" height="8.5" rx="0.6" fill="#fff"/>
          <rect x="13.5" y="0" width="3" height="11" rx="0.6" fill="#fff"/>
        </svg>
        <svg width="16" height="11" viewBox="0 0 16 11">
          <path d="M8 3C10.1 3 12 3.8 13.4 5.2L14.4 4.2C12.7 2.5 10.4 1.4 8 1.4S3.3 2.5 1.6 4.2l1 1C4 3.8 5.9 3 8 3z" fill="#fff"/>
          <path d="M8 6.3c1.3 0 2.4.5 3.2 1.3l1-1C11.1 5.5 9.6 4.8 8 4.8s-3.1.7-4.2 1.8l1 1C5.6 6.8 6.7 6.3 8 6.3z" fill="#fff"/>
          <circle cx="8" cy="9.7" r="1.4" fill="#fff"/>
        </svg>
        <svg width="26" height="12" viewBox="0 0 26 12">
          <rect x="0.5" y="0.5" width="22" height="11" rx="3" stroke="#fff" strokeOpacity="0.5" fill="none"/>
          <rect x="2" y="2" width="14" height="8" rx="1.5" fill="#fff"/>
          <path d="M24 4v4c.6-.2 1.2-1 1.2-2s-.6-1.8-1.2-2z" fill="#fff" fillOpacity="0.6"/>
        </svg>
      </div>
    </div>
  );
}

export default function Phone({ children }) {
  return (
    <div style={{
      width: 402, height: 874, borderRadius: 48, overflow: 'hidden',
      position: 'relative', background: '#fff',
      boxShadow: '0 40px 80px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.12)',
    }}>
      <div style={{ position: 'absolute', top: 11, left: '50%', transform: 'translateX(-50%)', width: 126, height: 37, borderRadius: 24, background: '#000', zIndex: 50 }} />
      <StatusBar />
      {children}
      <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', width: 139, height: 5, borderRadius: 100, background: 'rgba(0,0,0,0.25)', zIndex: 60 }} />
    </div>
  );
}
