alter table public.supply_links add column if not exists is_current boolean not null default true;
create index if not exists supply_links_current_idx on public.supply_links (is_current);