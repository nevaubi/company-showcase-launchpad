create index if not exists alt_data_title_idx on public.alt_data (dataset, title, ticker, date desc) where kind = 'series';

create or replace function public.alt_series_leaders(_dataset text, _title text)
returns table(ticker text, date date, value double precision, unit text, meta jsonb, source_url text, prior_value double precision, prior_date date, base_median double precision, base_n integer)
language sql
stable
set search_path = public
as $$
  with s as (
    select a.ticker, a.date, a.value, a.unit, a.meta, a.source_url
    from public.alt_data a
    where a.dataset = _dataset and a.title = _title and a.kind = 'series'
      and a.value is not null and a.date is not null and a.date <= current_date
      and a.date >= current_date - interval '6 years'
  ), last as (
    select distinct on (s.ticker) s.*
    from s
    where coalesce((s.meta->>'ytd')::boolean, false) = false
    order by s.ticker, s.date desc
  )
  select l.ticker, l.date, l.value, l.unit, l.meta, l.source_url,
         p.value, p.date, b.med, b.n
  from last l
  left join lateral (
    select s3.value, s3.date from s s3
    where s3.ticker = l.ticker and s3.date <= l.date - interval '360 days'
    order by s3.date desc limit 1
  ) p on true
  left join lateral (
    select percentile_cont(0.5) within group (order by s2.value) as med, count(*)::int as n
    from s s2
    where s2.ticker = l.ticker and s2.date < l.date and s2.date >= l.date - interval '1 year'
      and coalesce((s2.meta->>'ytd')::boolean, false) = false
  ) b on true
$$;

revoke all on function public.alt_series_leaders(text, text) from public, anon;
grant execute on function public.alt_series_leaders(text, text) to authenticated, service_role;