-- ============================================================================
-- Storage · Bucket PRIVADO para comprobantes de transferencia de Campeonatos
-- ============================================================================
-- Deja lista la infraestructura de Storage para el comprobante bancario (hoy el upload es mock).
-- NO construye el flujo de subida ni AlGrass-Admin: solo bucket + policies.
--
-- El path del objeto se guarda en la columna EXISTENTE championships.payment_voucher_ref
-- (añadida en championships_phase2_transfer_hold.sql). NO se crea columna nueva.
--
-- Convención de path (la identidad NO depende del filename):
--   {user_id}/{championship_id}/{filename}
-- El primer segmento = auth.uid() del owner → base de las policies de acceso propio.
--
-- Buckets existentes (venues/avatars) son PÚBLICOS (getPublicUrl). Este es PRIVADO: el owner
-- accede a lo suyo; Admin/staff leerá vía signed URL desde AlGrass-Admin (fase posterior).
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('championship-payment-proofs', 'championship-payment-proofs', false)
on conflict (id) do nothing;

-- Owner: sube (insert) SOLO bajo su propio prefijo {auth.uid()}/...
drop policy if exists "champ_proofs_owner_insert" on storage.objects;
create policy "champ_proofs_owner_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'championship-payment-proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Owner: lee SOLO lo suyo (para previsualizar el comprobante que subió).
drop policy if exists "champ_proofs_owner_select" on storage.objects;
create policy "champ_proofs_owner_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'championship-payment-proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Admin/staff: lee TODOS los comprobantes (AlGrass-Admin, vía signed URL). Sin listado público.
drop policy if exists "champ_proofs_admin_select" on storage.objects;
create policy "champ_proofs_admin_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'championship-payment-proofs'
    and exists (
      select 1 from public.user_roles
       where user_id = auth.uid() and role in ('algrass_admin', 'algrass_staff')
    )
  );

-- SIN policies de update/delete (comprobante inmutable) y SIN acceso anónimo/público.
