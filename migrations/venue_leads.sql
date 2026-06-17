-- Leads comerciales de dueños de canchas interesados en AlGrass.
-- Solo captura de contacto: sin lectura pública.

create table if not exists public.venue_leads (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  email      text not null,
  city       text not null,
  district   text not null,
  venue_name text not null,
  website    text,
  created_at timestamptz default now()
);

alter table public.venue_leads enable row level security;

-- INSERT permitido a usuarios autenticados. Sin policy de SELECT → sin lectura pública.
drop policy if exists "venue_leads_insert_authenticated" on public.venue_leads;
create policy "venue_leads_insert_authenticated"
  on public.venue_leads
  for insert
  to authenticated
  with check (true);
