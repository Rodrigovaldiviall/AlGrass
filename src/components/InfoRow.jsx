import { TEXT, SUB, SOFT } from '../constants';

// Bloque de info reutilizable: icono | (título / subtítulo) | acción.
// Mismo layout que el de GameDetail / FieldDetail / RentalDetail.
export default function InfoRow({ icon, primary, secondary, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
      <div style={{
        width: 42, height: 42, borderRadius: 12, background: SOFT,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--gd-ip, 15px)', fontWeight: 600, color: TEXT, lineHeight: 1.3 }}>{primary}</div>
        {secondary && (
          <div style={{ fontSize: 'var(--gd-is, 13px)', color: SUB, marginTop: 2, lineHeight: 1.35 }}>{secondary}</div>
        )}
      </div>
      {action}
    </div>
  );
}
