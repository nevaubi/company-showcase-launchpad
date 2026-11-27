-- Issuer-disclosed equipment inputs. Each record describes one named product and counterparty.
INSERT INTO public.supply_disclosures
  (id, provider_key, provider_name, recipient_key, recipient_name, product, stage, detail, source_phrase, publisher, source_date, reviewed_on, source_url, pathway)
VALUES
  ('issuer:dell-rubin-nvl72-fy27q3', 'NVDA', 'NVIDIA', 'DELL', 'Dell Technologies', 'Vera Rubin NVL72 for new Dell AI orders', 'contracted',
   'Dell said a majority of its new orders used the NVIDIA Vera Rubin NVL72 platform. Dell reported the order mix. Supplier revenue and the dollar value attributable to NVIDIA were undisclosed.',
   'a majority of our new orders', 'Dell Technologies · Q3 FY2027 earnings call, p. 3', '2026-11-24', '2026-11-27',
   'https://investors.delltechnologies.com/_assets/_4168568ad3b2a99ca990b00268d4e269/delltechnologies/db/3595/34778/webcast_transcript/Q3_FY27_Transcript.pdf#page=3', NULL),
  ('issuer:dell-amd-poweredge-fy27q3', 'AMD', 'AMD', 'DELL', 'Dell Technologies', 'Processors for PowerEdge R9815 and R9825', 'in_use',
   'Dell confirmed the launch of two AMD-based PowerEdge server platforms. The disclosure identifies the products and processor supplier. Shipment volumes were undisclosed.',
   'AMD-based PowerEdge R9815 and R9825', 'Dell Technologies · Q3 FY2027 earnings call, p. 3', '2026-11-24', '2026-11-27',
   'https://investors.delltechnologies.com/_assets/_4168568ad3b2a99ca990b00268d4e269/delltechnologies/db/3595/34778/webcast_transcript/Q3_FY27_Transcript.pdf#page=3', NULL),
  ('issuer:bloom-ntt-fuel-cells-2026', 'BE', 'Bloom Energy', 'NTT-DATA', 'NTT DATA', 'Onsite fuel cells for NTT Global Data Centers', 'contracted',
   'NTT DATA announced an agreement covering 900 MW across multiple data center projects. Initial shipments are expected in 2027. The 900 MW measures planned deployment capacity.',
   'initial shipments starting in 2027', 'NTT DATA', '2026-11-05', '2026-11-27',
   'https://www.nttdata.com/en-us/news/2026/ntt-data-announces-agreement-with-bloom-energy', NULL)
ON CONFLICT (id) DO NOTHING;
