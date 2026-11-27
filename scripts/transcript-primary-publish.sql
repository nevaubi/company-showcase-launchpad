-- Install documents only after validating issuer, source, complete turns and private original.
-- The per-issuer transaction lock prevents concurrent reviews from replacing one another.
DO $review$
DECLARE r jsonb; c jsonb; raw jsonb; o jsonb; d jsonb; b jsonb;
  sym text; id text; original_key text; raw_key text; idx_key text; old_calls jsonb; roster_words integer; merged jsonb; actual_words integer; n_turns integer; text_hash text; new_calls jsonb;
BEGIN
  FOR r IN SELECT document FROM pg_temp.reviewed_call_import LOOP
    id := r->'call'->>'call_id'; c:=r->'call'; o:=r->'original'; d:=r->'doc'; raw:=r->'turns'; sym:=r->>'ticker';
    IF sym IS DISTINCT FROM c->>'ticker' OR sym IS DISTINCT FROM raw->>'ticker' OR id IS DISTINCT FROM c->>'call_id'
     OR id IS DISTINCT FROM raw->'file'->>'call_id' OR d->>'url' IS DISTINCT FROM raw->>'sourceUrl'
     OR d->>'url' IS DISTINCT FROM o->>'sourceUrl' OR d->>'sha256' IS DISTINCT FROM o->>'sha256' OR c->>'doc' IS DISTINCT FROM o->>'sha256'
     OR raw->>'sourceHash' IS DISTINCT FROM c->>'sha' OR id IS DISTINCT FROM sym||'-'||(c->>'date')||'-'||left(c->>'sha',6)
    THEN RAISE EXCEPTION 'Issuer/source linkage failed for %',id;END IF;
    IF o->>'encoding'='storage-object' THEN
      IF NOT EXISTS(SELECT 1 FROM ir_documents i JOIN storage.objects ob ON ob.bucket_id=o->>'bucket' AND ob.name=i.path
          WHERE i.ticker=sym AND i.sha256=o->>'sha256' AND i.source_url=d->>'url' AND i.path=o->>'path')
      THEN RAISE EXCEPTION 'Private source object missing for %',id; END IF;
    ELSIF o->>'encoding' <> 'gzip+base64' OR encode(extensions.digest(decode(o->>'data','base64'),'sha256'),'hex')<>o->>'storedSha256'
    THEN RAISE EXCEPTION 'Source bytes failed verification for %',id; END IF;
    SELECT count(*),sum((t->>'w')::int),encode(extensions.digest(convert_to(string_agg(t->>'x',E'\n' order by ord),'utf8'),'sha256'),'hex')
     INTO n_turns,actual_words,text_hash FROM jsonb_array_elements(raw->'file'->'turns') WITH ORDINALITY z(t,ord);
    SELECT sum((s->>'words')::int) INTO roster_words FROM jsonb_array_elements(c->'speakers') s;
    IF n_turns<>(c->>'n_turns')::int OR actual_words<>(c->>'words')::int OR roster_words<>actual_words OR text_hash IS DISTINCT FROM c->>'sha'
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(raw->'file'->'turns') WITH ORDINALITY z(t,ord) WHERE (t->>'i')::int<>ord-1 OR t->>'sec' NOT IN ('qa','prepared')
        OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c->'speakers') sp WHERE sp->>'idx'=t->>'sp'))
    THEN RAISE EXCEPTION 'Incomplete original speaker turns for %',id; END IF;
    original_key:='issuer-original:v1:'||(o->>'sha256');raw_key:='issuer-turns:v1:'||sym||':'||id||':'||text_hash;idx_key:='issuer-direct-index:v1:'||sym;
    PERFORM pg_advisory_xact_lock(hashtextextended(idx_key,0));
    INSERT INTO ai_cache(key,payload,created_at) VALUES(original_key,o,now()),(raw_key,raw,now()) ON CONFLICT(key) DO NOTHING;
    IF NOT EXISTS(SELECT 1 FROM ai_cache WHERE key=raw_key AND payload->>'sha256'=raw->>'sha256' AND payload->>'documentSha256'=o->>'sha256')
    THEN RAISE EXCEPTION 'Immutable turn collision for %',id; END IF;
    SELECT payload->'bundle' INTO b FROM ai_cache WHERE key=idx_key;
    old_calls:=coalesce(b->'calls','[]'::jsonb);
    IF NOT (old_calls @> jsonb_build_array(c) AND coalesce(b->'docs','{}'::jsonb)->(c->>'doc')=d) THEN
      SELECT coalesce(jsonb_agg(v),'[]'::jsonb) INTO new_calls FROM jsonb_array_elements(old_calls) x(v)
        WHERE v->>'call_id'<>id AND b->'docs'->(v->>'doc')->>'url' IS DISTINCT FROM d->>'url';
      merged:=jsonb_build_object('ticker',sym,'generated',now(),'docs',coalesce(b->'docs','{}'::jsonb)||jsonb_build_object(c->>'doc',d),'calls',new_calls||jsonb_build_array(c));
      INSERT INTO ai_cache(key,payload,created_at) VALUES(idx_key,jsonb_build_object('bundle',merged,'sha256',encode(extensions.digest(convert_to(merged::text,'utf8'),'sha256'),'hex')),now())
       ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,created_at=excluded.created_at;
    END IF;
  END LOOP;
END $review$;
