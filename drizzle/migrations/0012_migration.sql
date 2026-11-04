create table public.supply_links (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  counterparty text not null,
  counterparty_ticker text,
  counterparty_domain text,
  relation text not null check (relation in ('customer','supplier','partner','competitor')),
  detail text not null,
  share_pct numeric,
  quote text not null,
  accn text not null,
  doc text not null,
  form text not null,
  filed date not null,
  created_at timestamptz not null default now()
);
create index supply_links_ticker_idx on public.supply_links (ticker);
create index supply_links_cp_idx on public.supply_links (counterparty_ticker);
alter table public.supply_links enable row level security;
grant select on public.supply_links to authenticated;
grant all on public.supply_links to service_role;
create policy "Signed-in users read supply links" on public.supply_links for select to authenticated using (true);