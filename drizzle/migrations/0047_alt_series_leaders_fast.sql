create or replace function public.alt_series_leaders(_dataset text, _title text)
returns table(ticker text, date date, value double precision, unit text, meta jsonb, source_url text, prior_value double precision, prior_date date, base_median double precision, base_n integer)
language sql
stable
set search_path = public
as $$
  with l as (
    select distinct on (a.ticker) a.ticker, a.date, a.value, a.unit, a.meta, a.source_url
    from public.alt_data a
    where a.dataset = _dataset and a.title = _title and a.kind = 'series'
      and a.value is not null and a.date is not null and a.date <= current_date
      and coalesce((a.meta->>'ytd')::boolean, false) = false
    order by a.ticker, a.date desc
  )
  select l.ticker, l.date, l.value, l.unit, l.meta, l.source_url,
         p.value, p.date, b.med, b.n
  from l
  left join lateral (
    select a.value, a.date from public.alt_data a
    where a.dataset = _dataset and a.title = _title and a.kind = 'series' and a.ticker = l.ticker
      and a.value is not null and a.date <= l.date - 360
    order by a.date desc limit 1
  ) p on true
  left join lateral (
    select percentile_cont(0.5) within group (order by a.value) as med, count(*)::int as n
    from public.alt_data a
    where a.dataset = _dataset and a.title = _title and a.kind = 'series' and a.ticker = l.ticker
      and a.value is not null and a.date < l.date and a.date >= l.date - 365
      and coalesce((a.meta->>'ytd')::boolean, false) = false
  ) b on true
$$;

revoke all on function public.alt_series_leaders(text, text) from public, anon;
grant execute on function public.alt_series_leaders(text, text) to authenticated, service_role;