-- Issuer-announced operating relationships supplement filing claims without changing their amounts or scores.
CREATE TABLE IF NOT EXISTS public.supply_disclosures (
  id text PRIMARY KEY,
  provider_key text NOT NULL,
  provider_name text NOT NULL,
  recipient_key text NOT NULL,
  recipient_name text NOT NULL,
  product text NOT NULL,
  stage text NOT NULL CHECK (stage IN ('in_use','contracted','planned','ended')),
  detail text NOT NULL,
  source_phrase text NOT NULL,
  publisher text NOT NULL,
  source_date date NOT NULL,
  reviewed_on date NOT NULL,
  source_url text NOT NULL CHECK (source_url ~ '^https://'),
  pathway text,
  CHECK (provider_key <> recipient_key)
);
CREATE INDEX IF NOT EXISTS supply_disclosures_provider_idx ON public.supply_disclosures(provider_key, source_date DESC, id);
CREATE INDEX IF NOT EXISTS supply_disclosures_recipient_idx ON public.supply_disclosures(recipient_key, source_date DESC, id);
CREATE INDEX IF NOT EXISTS supply_disclosures_pathway_idx ON public.supply_disclosures(pathway) WHERE pathway IS NOT NULL;
ALTER TABLE public.supply_disclosures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supply_disclosures FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.supply_disclosures TO authenticated;
GRANT ALL ON public.supply_disclosures TO service_role;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='supply_disclosures' AND policyname='Members read issuer disclosures') THEN
    CREATE POLICY "Members read issuer disclosures" ON public.supply_disclosures FOR SELECT TO authenticated USING (public.has_app_access(auth.uid()));
  END IF;
END $$;

-- Each row is one directed product or service relationship as of the linked publication.
-- Shared pathway labels only connect stages of the same disclosed product or manufacturing program.
WITH sources(slug, publisher, source_date, source_url) AS (VALUES
  ('apple-oct', 'Apple', '2026-10-20', 'https://www.apple.com/newsroom/2026/10/apple-announces-american-manufacturing-program-partners-for-latest-iphone-lineup'),
  ('apple-mar', 'Apple', '2026-03-26', 'https://www.apple.com/newsroom/2026/03/apple-adds-new-partners-to-its-american-manufacturing-program'),
  ('apple-aug', 'Apple', '2025-08-06', 'https://www.apple.com/newsroom/2025/08/apple-increases-us-commitment-to-600-billion-usd-announces-ambitious-program/'),
  ('core', 'CoreWeave', '2026-09-30', 'https://www.coreweave.com/news/coreweave-delivers-nvidia-vera-rubin-nvl72-performance-at-production-scale-starting-with-cognition'),
  ('boeing', 'Boeing', '2026-01-13', 'https://investors.boeing.com/investors/news/press-release-details/2026/Delta-Air-Lines-Orders-up-to-60-Boeing-787-Dreamliners-to-Grow-Modernize-Widebody-Fleet/default.aspx'),
  ('ge', 'GE Aerospace', '2026-01-13', 'https://www.geaerospace.com/news/press-releases/delta-air-lines-selects-ge-aerospace-genx-engines-power-new-787-10s'),
  ('corning', 'Corning', '2026-01-27', 'https://corning.com/worldwide/en/about-us/news-events/news-releases/2026/01/corning-and-meta-announce-multiyear-up-to-6-billion-agreement-to-accelerate-us-data-center-buildout.html'),
  ('vistra', 'Vistra', '2026-01-09', 'https://investor.vistracorp.com/2026-01-09-Vistra-and-Meta-Announce-Agreements-to-Support-Nuclear-Plants-in-PJM-and-Add-New-Nuclear-Generation-to-the-Grid'),
  ('clinton', 'Constellation Energy', '2025-06-03', 'https://www.constellationenergy.com/newsroom/2025/constellation-meta-sign-20-year-deal-for-clean-reliable-nuclear-energy-in-illinois.html'),
  ('wind', 'GE Vernova', '2026-11-17', 'https://www.gevernova.com/news/press-releases/ge-vernova-strengthens-german-wind-energy-expansion-new-order-wpd'),
  ('wind2', 'GE Vernova', '2026-11-09', 'https://www.gevernova.com/news/press-releases/ge-vernova-continues-wind-energy-expansion-germany-new-order-stadtwerke-heidenheim'),
  ('grid', 'GE Vernova', '2026-11-06', 'https://www.gevernova.com/news/press-releases/ge-vernova-support-india-energy-transition-6-gw-hvdc-transmission-project')
), facts(slug, provider_key, provider_name, recipient_key, recipient_name, product, stage, detail, source_phrase, pathway) AS (VALUES
  ('apple-oct', 'Q', 'Qnity Electronics', 'AAPL', 'Apple', 'Aperture-control film', 'planned', 'Qnity will manufacture film for the variable-aperture camera in the iPhone 18 Pro.', 'advanced films', NULL),
  ('apple-oct', '@perryman', 'Perryman Company', 'AAPL', 'Apple', 'Titanium enclosure', 'in_use', 'Perryman processes recycled-content titanium for the iPhone Duo enclosure in Pennsylvania.', 'melts, forges, and rolls', NULL),
  ('apple-oct', 'AVGO', 'Broadcom', 'AAPL', 'Apple', 'Radio-frequency components', 'in_use', 'Broadcom produces wireless components in Colorado under a multiyear Apple program.', 'radio frequency components', NULL),
  ('apple-oct', 'GLW', 'Corning', 'AAPL', 'Apple', 'Display cover glass', 'in_use', 'Corning manufactures Ceramic Shield and other specialty glass for Apple in Kentucky.', 'including Ceramic Shield', NULL),
  ('apple-oct', 'COHR', 'Coherent', 'AAPL', 'Apple', 'Face ID laser technology', 'in_use', 'Coherent supplies Texas-made lasers used for depth sensing in Apple devices.', 'vertical-cavity surface-emitting', NULL),
  ('apple-oct', 'TSM', 'TSMC', 'AAPL', 'Apple', 'Arizona-fabricated chips', 'in_use', 'Apple reports production for iPhone, iPad and Watch at TSMC’s Arizona fab.', 'Arizona fab', 'Arizona silicon'),
  ('apple-oct', 'AMKR', 'Amkor Technology', 'AAPL', 'Apple', 'Arizona packaging and test', 'planned', 'Apple expects to be among the first customers of Amkor’s Peoria facility. Construction was underway at disclosure.', 'first customers', NULL),
  ('apple-mar', 'TSM', 'TSMC', '@bosch', 'Bosch', 'Sensor integrated circuits', 'planned', 'The companies plan to fabricate Bosch sensor ICs at TSMC Washington in Camas.', 'TSMC Washington', 'Apple sensing hardware'),
  ('apple-mar', '@bosch', 'Bosch', 'AAPL', 'Apple', 'Sensing hardware', 'planned', 'Apple identifies the Bosch hardware program for device sensing, including crash detection and elevation.', 'sensing hardware', 'Apple sensing hardware'),
  ('apple-mar', 'GFS', 'GlobalFoundries', 'CRUS', 'Cirrus Logic', 'Mixed-signal semiconductor process', 'planned', 'GlobalFoundries’ Malta process is intended to enable Cirrus Logic ICs for Apple device applications.', 'Malta, New York', 'Apple mixed-signal ICs'),
  ('apple-mar', 'CRUS', 'Cirrus Logic', 'AAPL', 'Apple', 'Mixed-signal ICs', 'planned', 'Cirrus Logic is developing ICs for Apple applications including Face ID.', 'mixed-signal solutions', 'Apple mixed-signal ICs'),
  ('apple-aug', '@gwa', 'GlobalWafers America', 'TSM', 'TSMC', '300 mm silicon wafers', 'planned', 'Apple named the Phoenix fab as an intended user of GlobalWafers America wafers for Apple devices.', '300mm wafers', 'Arizona silicon'),
  ('apple-aug', 'AMAT', 'Applied Materials', 'TXN', 'Texas Instruments', 'Fab equipment', 'in_use', 'Apple reports that TI’s U.S. fabs use equipment made by Applied Materials in Austin.', 'Applied Materials’ factory', 'TI foundational semiconductors'),
  ('apple-aug', 'TXN', 'Texas Instruments', 'AAPL', 'Apple', 'Foundational semiconductors', 'planned', 'TI’s Lehi and Sherman facilities are expected to manufacture chips for Apple products.', 'foundational semiconductors', 'TI foundational semiconductors'),
  ('core', 'NVDA', 'NVIDIA', 'CRWV', 'CoreWeave', 'Vera Rubin NVL72 systems', 'in_use', 'CoreWeave announced production availability of NVIDIA’s Vera Rubin platform on its AI cloud.', 'availability of NVIDIA Vera Rubin', 'Vera Rubin cloud'),
  ('core', 'CRWV', 'CoreWeave', '@cognition', 'Cognition', 'Vera Rubin cloud compute', 'in_use', 'CoreWeave identified Cognition as its first production user of the system.', 'running production workloads', 'Vera Rubin cloud'),
  ('boeing', 'BA', 'Boeing', 'DAL', 'Delta Air Lines', '787-10 aircraft', 'contracted', 'Delta placed a firm order for 30 jets. Another 30 are options.', '30 787-10 jets', NULL),
  ('ge', 'GE', 'GE Aerospace', 'DAL', 'Delta Air Lines', 'GEnx engines and services', 'contracted', 'Delta selected engines for its 30 ordered 787-10s. The agreement covers spares and long-term service.', 'spare engines and long-term services', NULL),
  ('corning', 'GLW', 'Corning', 'META', 'Meta Platforms', 'Optical fiber and cable', 'contracted', 'Meta agreed to procure optical connectivity for U.S. data centers. The multiyear ceiling is $6 billion.', 'up to $6 billion', NULL),
  ('vistra', 'VST', 'Vistra', 'META', 'Meta Platforms', 'Nuclear power agreements', 'contracted', 'Three PJM plants are covered. The release scheduled initial purchases for late 2026 and incremental capacity through 2034.', 'begin in late 2026', NULL),
  ('clinton', 'CEG', 'Constellation Energy', 'META', 'Meta Platforms', 'Clinton clean-energy attributes', 'contracted', 'The 20-year agreement begins in June 2027. Electricity from the plant continues to flow onto the regional grid.', 'Beginning in June of 2027', NULL),
  ('wind', 'GEV', 'GE Vernova', '@wpd', 'wpd', 'Haseloff onshore turbines', 'contracted', 'Four turbines and service were ordered. Delivery was scheduled for November 2027 with commissioning in early 2028.', 'Haseloff wind farm', NULL),
  ('wind2', 'GEV', 'GE Vernova', '@stadtwerke-heidenheim', 'Stadtwerke Heidenheim', 'Schlotberg-Jüchsen turbines', 'contracted', 'Three turbines and 20 years of service were ordered. The announced delivery schedule starts in August 2027.', 'Schlotberg-Jüchsen wind farm', NULL),
  ('grid', 'GEV', 'GE Vernova', '@powergrid-india', 'Power Grid Corporation of India', 'Barmer–South Kalamb HVDC', 'contracted', 'India’s grid operator selected GE Vernova for a 6 GW transmission corridor, including converter stations and commissioning.', 'South Kalamb', NULL)
)
INSERT INTO public.supply_disclosures(id, provider_key, provider_name, recipient_key, recipient_name, product, stage, detail, source_phrase, pathway, publisher, source_date, source_url, reviewed_on)
SELECT concat_ws(':', slug, provider_key, recipient_key), provider_key, provider_name, recipient_key, recipient_name,
       product, stage, detail, source_phrase, pathway, publisher, source_date::date, source_url, DATE '2026-11-27'
FROM facts JOIN sources USING (slug)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.supply_disclosures(id, provider_key, provider_name, recipient_key, recipient_name, product, stage, detail, source_phrase, publisher, source_date, source_url, reviewed_on) VALUES
  ('flagstar-fintech', 'FISV', 'Fiserv', 'FLG', 'Flagstar Bank', 'Finxact core banking', 'contracted', 'Flagstar selected Fiserv’s Finxact as its future system of record. It announced a phased conversion.', 'planned conversions', 'Fiserv', '2026-08-17', 'https://investors.fiserv.com/news-releases/news-release-details/fiserv-and-flagstar-bank-announce-strategic-core-banking', DATE '2026-11-27'),
  ('fcb-core', 'FIS', 'Fidelity National Information Services', '@first-commerce-new-jersey', 'First Commerce Bank (New Jersey)', 'HORIZON core banking', 'contracted', 'First Commerce selected FIS HORIZON as its future core platform.', 'HORIZON ecosystem', 'FIS', '2026-06-17', 'https://www.investor.fisglobal.com/news-releases/news-release-details/first-commerce-bank-selects-fis-core-banking-compete-ai-ready', DATE '2026-11-27'),
  ('apple-chase', 'JPM', 'JPMorgan Chase', 'AAPL', 'Apple', 'Apple Card issuing', 'planned', 'Chase was named the future issuer. Apple expected the transition to take approximately 24 months from the January announcement.', 'expected transition', 'Apple', '2026-01-07', 'https://www.apple.com/newsroom/2026/01/chase-to-become-new-issuer-of-apple-card', DATE '2026-11-27'),
  ('apple-mastercard', 'MA', 'Mastercard', 'AAPL', 'Apple', 'Card payment network', 'in_use', 'Apple identified Mastercard as the continuing network for Apple Card during the planned issuer transition.', 'remain the payment network', 'Apple', '2026-01-07', 'https://www.apple.com/newsroom/2026/01/chase-to-become-new-issuer-of-apple-card', DATE '2026-11-27')
ON CONFLICT (id) DO NOTHING;