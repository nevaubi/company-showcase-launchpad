create or replace function public.alt_event_buckets()
returns table(ticker text, dataset text, bucket int, n bigint, last_date date)
language sql stable security invoker set search_path = public as $$
  select ticker, dataset, ((current_date - date) / 90)::int as bucket, count(*), max(date)
  from public.alt_data
  where kind = 'event' and date is not null and date <= current_date and date > current_date - 810
  group by 1, 2, 3
$$;
create or replace function public.alt_source_stats()
returns table(dataset text, rows bigint, tickers bigint, latest date, refreshed timestamptz)
language sql stable security invoker set search_path = public as $$
  select dataset, count(*), count(distinct ticker), max(date) filter (where date <= current_date), max(created_at)
  from public.alt_data group by 1
$$;
grant execute on function public.alt_event_buckets() to authenticated;
grant execute on function public.alt_source_stats() to authenticated;