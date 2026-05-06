import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL ?? '';
const key = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

// ── ACCOUNT LINKING — Configuración en Supabase Dashboard ─────────────────
// Ruta: Dashboard → Authentication → Sign In / Sign Up → "Identities"
//
// 1. "Allow linking of identities" (manual): permite llamar a
//    supabase.auth.linkIdentity({ provider }) desde una sesión activa para
//    añadir un proveedor adicional a la cuenta del usuario.
//    → Habilitar cuando se implemente el botón "Vincular cuenta" en Ajustes.
//
// 2. "Automatic identity linking": cuando un usuario intenta autenticarse con
//    un proveedor diferente (Google, Facebook, email) usando el mismo correo
//    que ya existe en otra cuenta, Supabase fusiona ambas cuentas
//    automáticamente sin crear un duplicado.
//    → Habilitar en producción para evitar cuentas duplicadas por email.
//
// Referencia: https://supabase.com/docs/guides/auth/auth-identity-linking
// ──────────────────────────────────────────────────────────────────────────

export const supabase = url && key ? createClient(url, key) : null;
