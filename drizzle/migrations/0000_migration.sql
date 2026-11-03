-- Profiles
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  avatar_url text,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Watchlist follows
CREATE TABLE public.watchlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  ticker text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, ticker)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.watchlist TO authenticated;
GRANT ALL ON public.watchlist TO service_role;
ALTER TABLE public.watchlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own watchlist select" ON public.watchlist FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own watchlist insert" ON public.watchlist FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own watchlist update" ON public.watchlist FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own watchlist delete" ON public.watchlist FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Investment theses
CREATE TABLE public.theses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  ticker text NOT NULL,
  title text NOT NULL,
  stance text NOT NULL DEFAULT 'long' CHECK (stance IN ('long','short','neutral')),
  conviction smallint NOT NULL DEFAULT 3 CHECK (conviction BETWEEN 1 AND 5),
  entry_price numeric,
  target_price numeric,
  horizon text,
  summary text NOT NULL DEFAULT '',
  catalysts text[] NOT NULL DEFAULT '{}',
  risks text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  is_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.theses TO authenticated;
GRANT ALL ON public.theses TO service_role;
ALTER TABLE public.theses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own or public theses" ON public.theses FOR SELECT TO authenticated USING (auth.uid() = user_id OR is_public);
CREATE POLICY "Insert own theses" ON public.theses FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Update own theses" ON public.theses FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Delete own theses" ON public.theses FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX theses_user_idx ON public.theses (user_id, updated_at DESC);

CREATE TABLE public.thesis_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thesis_id uuid NOT NULL REFERENCES public.theses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'note' CHECK (kind IN ('note','catalyst','risk','earnings','price')),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.thesis_updates TO authenticated;
GRANT ALL ON public.thesis_updates TO service_role;
ALTER TABLE public.thesis_updates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read updates of visible theses" ON public.thesis_updates FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.theses t WHERE t.id = thesis_id AND t.is_public));
CREATE POLICY "Insert own updates" ON public.thesis_updates FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.theses t WHERE t.id = thesis_id AND t.user_id = auth.uid()));
CREATE POLICY "Delete own updates" ON public.thesis_updates FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX thesis_updates_thesis_idx ON public.thesis_updates (thesis_id, created_at DESC);

-- Research agent sessions
CREATE TABLE public.research_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL DEFAULT 'New research',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.research_sessions TO authenticated;
GRANT ALL ON public.research_sessions TO service_role;
ALTER TABLE public.research_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own sessions select" ON public.research_sessions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own sessions insert" ON public.research_sessions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own sessions update" ON public.research_sessions FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own sessions delete" ON public.research_sessions FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.research_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.research_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL DEFAULT '',
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.research_messages TO authenticated;
GRANT ALL ON public.research_messages TO service_role;
ALTER TABLE public.research_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own messages select" ON public.research_messages FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own messages insert" ON public.research_messages FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.research_sessions s WHERE s.id = session_id AND s.user_id = auth.uid()));
CREATE POLICY "Own messages delete" ON public.research_messages FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX research_messages_session_idx ON public.research_messages (session_id, created_at);

-- Workspace documents (docs and sheets)
CREATE TABLE public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('doc','sheet')),
  title text NOT NULL DEFAULT 'Untitled',
  ticker text,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;
GRANT ALL ON public.documents TO service_role;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own documents select" ON public.documents FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own documents insert" ON public.documents FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own documents update" ON public.documents FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own documents delete" ON public.documents FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX documents_user_idx ON public.documents (user_id, kind, updated_at DESC);

-- Server-only cache for AI summaries (narratives, briefs). No client access.
CREATE TABLE public.ai_cache (
  key text PRIMARY KEY,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.ai_cache TO service_role;
ALTER TABLE public.ai_cache ENABLE ROW LEVEL SECURITY;

-- updated_at maintenance
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER theses_touch BEFORE UPDATE ON public.theses FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER sessions_touch BEFORE UPDATE ON public.research_sessions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER documents_touch BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Profile + starter watchlist on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.watchlist (user_id, ticker)
  VALUES (NEW.id, 'AAPL'), (NEW.id, 'NVDA'), (NEW.id, 'MSFT')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();