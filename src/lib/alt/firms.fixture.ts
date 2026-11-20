// Real firm names stored in production `alt_data` (2026-11-20), copied with the checksum method of
// fu/round2/TRANSFER.md: ticker | firm | stored rows. FDA_FIRMS: every distinct openFDA recalling
// firm stored under each ticker (476 pairs, 6,544 recall rows). TRIAL_SPONSORS: every distinct
// ClinicalTrials.gov lead sponsor (248 pairs, 13,701 rows). Text folded to ASCII (one sponsor,
// "Sarl", had a non-ASCII letter). SHORT_NAMES: coverage short names. Test data only.
export const FDA_FIRMS = `
A|Agilent Technologies|1
A|Agilent Technologies Denmark ApS|1
A|AGILENT TECHNOLOGIES INC./US|1
A|Agilent Technologies, Inc.|4
ABBV|AbbVie Inc|6
ABBV|AbbVie Inc.|12
ABT|Abbott Laboratories|162
ABT|Abbott Laboratories Diagnostic Div|11
ABT|Abbott Laboratories HPD/ADD|10
ABT|Abbott Laboratories HPD/ADD/GPRD|21
ABT|Abbott Laboratories Inc.|12
ABT|Abbott Laboratories Inc. (St Jude Medical)|3
ABT|Abbott Laboratories Medisense Products|1
ABT|Abbott Laboratories MPG|13
ABT|Abbott Laboratories, Inc|55
ABT|Abbott Laboratories, Inc.|2
ABT|Abbott Nutrition, Abbott Laboratories|1
ABT|Abbott Nutrition, Division of Abbott Laboratories|2
ABT|Ross Products Division Abbott Laboratories|5
ABT|Ross Products Division, Abbott Laboratories|1
ACI|Albertsons Companies LLC|175
ACI|Albertsons Companies, Inc.|14
ADM|Archer Daniels Midland Company|1
ALGN|Align Technology Inc|1
ALKS|Alkermes Inc|1
ALKS|Alkermes, Inc.|3
AMGN|Amgen, Inc.|12
AMPH|Amphastar Pharmaceuticals, Inc.|1
AMRX|Amneal Pharmaceuticals|1
AMRX|Amneal Pharmaceuticals LLC|2
AMRX|Amneal Pharmaceuticals of New York, LLC|26
AMRX|Amneal Pharmaceuticals of New York, LLC.|1
AMRX|Amneal Pharmaceuticals, Inc.|10
AMRX|Amneal Pharmaceuticals, LLC|12
ANIP|ANI Pharmaceuticals, Inc.|13
AORT|Cryolife Inc|41
AORT|CryoLife, Inc.|16
ATRC|Atricure Inc|3
ATRC|AtriCure, Inc.|6
AVTR|Avantor Performance Materials Inc|2
AVTR|Avantor Performance Materials LLC|1
BDX|Becton Dickinson & Co|1
BDX|Becton Dickinson & Co.|115
BDX|Becton Dickinson & Company|130
BDX|Becton Dickinson and Company|10
BDX|Becton Dickinson Infusion Therapy|5
BDX|Becton Dickinson Infusion Therapy Systems Inc.|4
BDX|Becton Dickinson Infusion Therapy Systems, Inc.|3
BDX|Becton Dickinson Medical Systems|4
BDX|Becton, Dickinson and Company|2
BDX|Becton, Dickinson and Company, BD Bio Sciences|4
BDX|Becton, Dickinson and Company, BD Biosciences|22
BFLY|Butterfly Network, Inc.|2
BIIB|Biogen MA Inc.|2
BIO|Bio Rad Laboratories, Inc.|2
BIO|Bio-Rad Laboratories|13
BIO|Bio-Rad Laboratories Inc|30
BIO|Bio-Rad Laboratories, Inc|2
BIO|Bio-rad Laboratories, Inc.|1
BIO|Bio-Rad Laboratories, Inc.|20
BIO|Bio-Rad Laboratories, Inc., Hercules, CA|1
BLCO|Bausch & Lomb|2
BLCO|Bausch & Lomb Inc|23
BLCO|Bausch & Lomb Inc Irb|4
BLCO|Bausch & Lomb Inc- Greenville Solutions Plant|2
BLCO|Bausch & Lomb Incorporated|1
BLCO|Bausch & Lomb Surgical, Inc.|9
BLCO|Bausch & Lomb, Inc.|9
BMY|Bristol Myers Squibb Manufacturing Company|1
BMY|Bristol-myers Squibb Company|4
BMY|Bristol-Myers Squibb Company|1
BSX|Boston Scientific|15
BSX|Boston Scientific Cork, Ltd.|1
BSX|Boston Scientific Corp|41
BSX|Boston Scientific Corporation|255
BSX|Boston Scientific Corporation, Neurovascular, 47900 Bayside Parkway, Fremont, CA 94538|1
BSX|Boston Scientific CRM Corp|29
BSX|Boston Scientific Cupertino, Corporation|1
BSX|Boston Scientific Marlbourgh|1
BSX|Boston Scientific Neuromodulation Corporation|15
BSX|Boston Scientific Scimed|14
BSX|Boston Scientific Target|7
CAG|CONAGRA BRANDS|7
CAH|AccessClosure, Inc., A Cardinal Health Company|2
CAH|Cardinal Health|38
CAH|Cardinal Health 200, LLC|63
CAH|Cardinal Health 203, Inc|2
CAH|Cardinal Health 303 dba Cardinal Health|3
CAH|Cardinal Health 303 Inc DBA Alaris Products|7
CAH|Cardinal Health dba Specialty Pharmaceutical Services|1
CAH|Cardinal Health Inc|1
CAH|Cardinal Health Inc.|218
CAH|Cardinal Health Manufacturing LLC|1
CAH|Cardinal Health NeuroCare Division|2
CAH|Cardinal Health, Inc|2
CAH|Cardinal Health, Medical Products & Services|1
CAI|CARIS LIFE SCIENCES|1
CALM|Cal Maine Foods|1
CASY|Casey's Bakery, Inc|2
CHD|Church & Dwight Co|1
CHD|Church & Dwight Co., Inc.|2
CHD|Church & Dwight Co., Inc. OGI Distribution Center|6
CHD|Church & Dwight Inc|15
CHEF|Chefs Warehouse|5
CL|Colgate Palmolive Co|1
CL|Colgate Palmolive Company|2
CLX|Clorox Co (The)|2
CLX|Clorox Healthcare Holdings, LLC (dba HealthLink)|1
CNMD|Conmed Corporation|10
CNMD|ConMed Corporation|29
CNMD|Conmed Electrosurgery|1
CNMD|ConMed Electrosurgery|8
CNMD|Conmed Endoscopic Technologies, Inc.|2
CNMD|Conmed Linvatec Endoscopy Division|1
CNMD|Linvatec Corp. dba ConMed Linvatec|28
COKE|COCA COLA Consolidated LLC|3
COKE|Coca-Cola Consolidated|1
COST|Costco Wholesale|1
COST|Costco Wholesale Corporation|5
CVS|CVS Health|1
DG|Dollar General Corporation|28
DG|Dollar General Corporation, Inc.|1
DLTR|Dollar Tree Distribution, Inc.|7
DXCM|Dexcom Inc|4
DXCM|Dexcom, Inc.|7
EPC|Edgewell Personal Care Brands, LLC|1
EW|Edwards Lifesciences AG|2
EW|Edwards Lifesciences Corporation of Puerto Rico|2
EW|Edwards Lifesciences Llc|5
EW|Edwards Lifesciences Research Medical Inc|1
EW|Edwards Lifesciences Research Medical, Inc.|5
EW|Edwards Lifesciences Technology SARL|1
EW|Edwards Lifesciences, Llc|9
EW|Edwards Lifesciences, LLC|53
FLO|Flowers Foods|3
FLO|FLOWERS FOODS|14
FLO|Flowers Foods (Corporate Offices)|16
GE|General Electric Med Systems|6
GE|General Electric Med Systems LLC|14
GE|General Electric Med. Sys. Ultrasound|1
GE|General Electric Medical Systems Information Technology|10
GEHC|Datex Ohmeda, Inc.  dba GE Healthcare|4
GEHC|Ge Healthcare|9
GEHC|GE Healthcare|88
GEHC|GE Healthcare (China) Co., Ltd.|4
GEHC|GE HEALTHCARE AUSTRIA GMBH & CO|1
GEHC|GE Healthcare Beijing , Hangwei Medical Systems, Co. LTD|1
GEHC|GE Healthcare Biosciences|1
GEHC|GE Healthcare Clinical Systems|1
GEHC|GE Healthcare Finland Oy|5
GEHC|GE Healthcare GmbH|2
GEHC|GE Healthcare Inc. Life Sciences|1
GEHC|GE Healthcare Integrated IT Solutions|20
GEHC|GE Healthcare Ireland Limited|2
GEHC|Ge Healthcare It|13
GEHC|GE Healthcare It|10
GEHC|GE Healthcare Japan Corporation|1
GEHC|GE Healthcare LLC|1
GEHC|Ge Healthcare, Llc|7
GEHC|GE Healthcare, LLC|277
GEHC|Medi-Physics Inc. dba GE Healthcare|2
GEHC|Vital Signs Devices, a GE Healthcare Company|7
GEHC|Wipro GE Healthcare Private Ltd.|3
GILD|Gilead Sciences, Inc.|7
GIS|General Mills James Ford Bell Technical Center|3
GIS|General Mills, Inc|36
GIS|General Mills, Inc.|2
GMED|Globus Medical, Inc.|6
GRDN|Guardian Pharmacy Services|24
HAE|Haemonetics Corporation|17
HAE|Haemoscope Division of Haemonetics Corp|2
HON|HONEYWELL INC|1
HRL|Hormel Foods Corporation|10
HSIC|Henry Schein Inc.|2
HSIC|Henry Schein Inc. and Glove Club HSI Gloves Inc.|1
HSIC|Henry Schein, Inc.|2
ICUI|ICU Medical de Mexico, S.A. de C.V.|1
ICUI|ICU Medical Inc|24
ICUI|ICU Medical Inc.|3
ICUI|ICU Medical, Inc.|58
ICUI|Otsuka ICU Medical LLC|3
ILMN|Illumina Inc|3
ILMN|Illumina, Inc.|6
IMKTA|Ingles Markets|2
INGR|Ingredion|1
INGR|Ingredion Incorporated|4
INSP|Inspire Medical Systems Inc.|4
ISRG|Intuitive Surgical Inc|1
ISRG|Intuitive Surgical, Inc.|121
JNJ|Depuy Mitek, a Johnson & Johnson Co.|3
JNJ|DePuy Mitek, Inc., a Johnson & Johnson Co.|23
JNJ|Ethicon Sarl, a Johnson & Johnson Company|1
JNJ|Johnson & Johnson|4
JNJ|Johnson & Johnson Consumer, Inc.|21
JNJ|Johnson & Johnson Surgical Vision Inc|7
JNJ|Johnson & Johnson Surgical Vision, Inc.|8
JNJ|Johnson & Johnson Vision Care, Inc.|8
KDP|KEURIG DR PEPPER|7
KDP|Keurig Dr Pepper, Inc.|1
KDP|Keurig DR Pepper, Inc.|1
KHC|Kraft Heinz Foods|9
KHC|KRAFT HEINZ FOODS COMPANY|19
KHC|The Kraft Heinz Company|3
KHC|THE KRAFT HEINZ COMPANY|3
KMB|Kimberly-Clark Corporation|22
KO|Chattanooga Coca Cola Bottling Company dba United Packers, Inc.|1
KO|Coca Cola|4
KO|COCA COLA BOTTLING COMPAN|3
KO|Coca Cola Bottling Company United-East, LLC|1
KO|Coca Cola Bottling Company United, LLC|1
KO|Coca Cola Bottling Group United|1
KO|COCA COLA Consolidated LLC|3
KO|COCA COLA SOUTHWEST BEVERAGES LLC|1
KO|Coca-Cola Company  (The)|14
KO|Coca-Cola Consolidated|1
KO|Coca-Cola Refreshments USA, Inc.|6
KO|Coca-Cola Refreshments, USA Inc.|1
KO|Great Lakes Coca-Cola Distribution LLC|2
KO|Heartland Coca-Cola Bottling Company|20
KO|Reyes Coca-Cola Bottling, L.L.C.|1
KO|Swire Coca Cola USA|3
KO|The Coca Cola Company|3
KO|The Coca-Cola Company|9
KO|THE COCA-COLA COMPANY|3
KO|World of Coca-Cola|1
KR|Kroger Co|10
KR|Kroger Corporate Food Technology Laboratory|2
KR|Kroger Specialty Pharmacy, Inc.|67
KR|The Kroger Co|91
KR|The Kroger Company|1
KVUE|Kenvue Brands LLC|1
LIVN|LivaNova Deutschland GmbH|4
LIVN|LivaNova USA|4
LIVN|LivaNova USA Inc|9
LIVN|LivaNova USA Inc.|7
LIVN|LivaNova USA, Inc.|3
LLY|Eli Lilly & Co|1
LLY|Eli Lilly & Company|4
LLY|Eli Lilly and Company|1
LMAT|Lemaitre Vascular, Inc.|5
LMAT|LeMaitre Vascular, Inc.|22
MCK|Mckesson|1
MCK|McKesson|3
MCK|Mckesson Corporation|1
MCK|MCKESSON CORPORATION|1
MCK|McKesson Corporation dba McKesson Drug Company|6
MCK|McKesson General Medical Corporation|1
MCK|Mckesson Information Solutions LLC|6
MCK|McKesson Israel Ltd.|2
MCK|Mckesson Medical Imaging|1
MCK|Mckesson Medical Imaging Group|2
MCK|Mckesson Medical Immaging|5
MCK|Mckesson Medical Surgical|1
MCK|Mckesson Medical-Surgical Inc. Corporate Office|165
MCK|Mckesson Packaging Services|14
MCK|McKesson Packaging Services|3
MCK|McKesson Provider Technologies|1
MCK|McKesson Provider Technologies - Medical Imaging Group|3
MCK|MCKESSON TECHNOLOGIES INC|1
MCK|MCKESSON TECHNOLOGIES INC.|1
MCK|McKesson Technologies, Inc.|1
MCK|Rx Pak Division of McKesson Corporation|1
MDLN|MEDLINE IND|1
MDLN|Medline Industries Inc|132
MDLN|MEDLINE INDUSTRIES INC|3
MDLN|Medline Industries Inc (Northpoint Services)|1
MDLN|Medline Industries Inc.|1
MDLN|Medline Industries, Inc.|7
MDLN|Medline Industries, LP|74
MDLN|MEDLINE INDUSTRIES, LP - Northfield|126
MDLN|MEDLINE INDUSTRIES, LP - SPT|1
MDLZ|Mondelez Global Llc|37
MDLZ|Mondelez International|4
MDLZ|Mondelez Puerto Rico|4
MDT|COVIDIEN MEDTRONIC|3
MDT|Medtronic|7
MDT|Medtronic Advanced Energy, LLC|2
MDT|MEDTRONIC ATS MEDICAL, INC.|2
MDT|Medtronic Ave Inc|1
MDT|Medtronic Cardiac Surgery Technologies|5
MDT|Medtronic Cardiovascular|1
MDT|Medtronic CardioVascular|5
MDT|Medtronic Cardiovascular Revascularization & Surgical Therap|5
MDT|Medtronic Cardiovascular Surgery-the Heart Valve Division|4
MDT|Medtronic CoreValve LLC|1
MDT|Medtronic Emergency Response Systems, Inc.|15
MDT|Medtronic formerly Covidien|1
MDT|Medtronic Gastroenterology / Urology|5
MDT|Medtronic Heart Valve Division|1
MDT|Medtronic Heart Valves Division|3
MDT|Medtronic Image Guided Neurologics, Inc.|1
MDT|Medtronic Inc|17
MDT|Medtronic Inc, Neurological & Spinal Division|6
MDT|Medtronic Inc.|31
MDT|Medtronic Inc. Cardiac Rhythm Disease Management|21
MDT|Medtronic Inc. Cardiac Rhythm Disease Managment|9
MDT|Medtronic Inc. Cardiac Rhythm Managment|12
MDT|Medtronic Inc., Cardiac Rhythm and Heart Failure|7
MDT|Medtronic Inc., Cardiac Rhythm and Heart Failure (CRHF)|30
MDT|Medtronic International Trade Inc|1
MDT|Medtronic Minimally Invasive Therapies Group|2
MDT|Medtronic Minimed|2
MDT|Medtronic MiniMed|17
MDT|Medtronic MiniMed Inc.|9
MDT|Medtronic MiniMed, Inc.|17
MDT|Medtronic Navigation|1
MDT|Medtronic Navigation, Inc|10
MDT|Medtronic Navigation, Inc.|50
MDT|Medtronic Navigation, Inc.-Boxborough|2
MDT|Medtronic Navigation, Inc.-Littleton|11
MDT|Medtronic Neurological|4
MDT|Medtronic Neuromodulation|103
MDT|Medtronic Neurosurgery|20
MDT|Medtronic Perfusion Systems|49
MDT|Medtronic Physio Control Corp|7
MDT|Medtronic Powered Surgical Solutions|2
MDT|Medtronic Sofamor Danek Instrument Manufacturing|5
MDT|Medtronic Sofamor Danek USA Inc|43
MDT|Medtronic Sofamor Danek USA, Inc|3
MDT|Medtronic Sofamor Danek Usa, Inc - Dallas Distribution|4
MDT|Medtronic Spine LLC (formerly Kyphon Inc.)|1
MDT|Medtronic Spine LLC, formerly Kyphon Inc|2
MDT|Medtronic Surgical Navigation Tech, Inc|1
MDT|Medtronic Surgical Navigation Technologies, Inc|1
MDT|Medtronic Vascular|12
MDT|Medtronic Vascular Galway DBA Medtronic Ireland|3
MDT|Medtronic Vascular Galway Limited|1
MDT|Medtronic Vascular, Inc.|14
MDT|Medtronic Xomed, Inc.|25
MDT|Medtronic, Inc.|14
MDT|Medtronic, Inc. - Neuromodulation|3
MDT|Medtronic, PLC|1
MDT|Medtronic,Inc/Rice Creek Facil|1
MDT|Warsaw Orthopedic, Inc. dba Medtronic SOFAMOR DANEK|3
MKC|Mccormick|1
MKC|McCormick &  Company - Corporate Headquarters|4
MKC|McCormick & Co Inc. Spice Mill Plant|1
MKC|McCormick & Company - MSS - HQ|3
MKC|McCormick & Company,  Inc.|4
MKC|McCormick & Company,  Inc.- Consumer Product Division|2
MKC|McCormick & Company, Inc. - Flavor Manufacturing Center|4
MMSI|Merit Medical Systems, Inc|13
MMSI|Merit Medical Systems, Inc.|82
MRK|Merck & Co Inc|4
MRK|Merck & Co. Inc|1
MRK|Merck Millipore Ltd.|1
MRK|Merck Sharp & Dohme|1
MRK|MERCK SHARP & DOHME CORP|2
MRK|Merck Sharp & Dohme LLC|2
MRK|Merck Sharp & Dohme, Wilson Facility|1
MZTI|T Marzetti Co|1
MZTI|T MARZETTI INNOVATION CENTER|1
MZTI|T. Marzetti Company|2
NEOG|Neogen Corporation|2
OGN|Organon Llc|3
OGN|Organon Teknika Inc|1
OMCL|Omnicell, Inc.|2
OMCL|OmniCell, Inc.|1
PBH|Insight Pharmaceuticals LLC, a Prestige Consumer Healthcare company|4
PEN|Penumbra Inc.|8
PEN|Penumbra, Inc.|1
PEP|Comercializadora Pepsico Mexico,|2
PEP|PepsiCo Beverages & Foods|2
PEP|Pepsico Foods International|1
PEP|Pepsico Gatorade Plant|1
PEP|Pepsico Inc|17
PEP|Pepsico Inc.|1
PFE|Hospira a Pfizer Company|4
PFE|Hospira Inc. A Pfizer Company|1
PFE|Hospira Inc., A Pfizer Company|9
PFE|King Legacy, a wholly owned subsidiary of Pfizer|11
PFE|Meridian Medical Technologies a Pfizer Company|3
PFE|Pfizer|4
PFE|PFIZER|2
PFE|Pfizer Global|1
PFE|Pfizer Global Supply|1
PFE|Pfizer Inc|5
PFE|PFIZER INC|2
PFE|Pfizer Inc.|112
PFE|Pfizer Manufacturing Deutschland GmbH|1
PFE|Pfizer Us Pharmaceutical Group|4
PFE|PFIZER, INC|2
PFGC|Performance Food Group, Inc.|1
PG|Procter & Gamble Co|3
PG|Procter & Gamble Hair Care Llc|1
PG|The Procter & Gamble Company|27
PODD|Insulet Corporation|15
QDEL|QUIDELORTHO|1
REGN|Regeneron Pharmaceuticals Inc|3
RGEN|REPLIGEN CORPORATION|1
RMD|Resmed Corporation|3
RMD|ResMed Ltd.|5
SEB|Capital Seaboard|1
SFM|Sprouts Farmers Market|3
SMPL|SIMPLY GOOD FOODS CO|2
STE|Steris Corp|13
STE|Steris Corporation|74
STE|Steris Corporation Hopkins Facility|4
STE|Steris Corportion|1
SUPN|Supernus Pharmaceuticals, Inc.|3
SYK|Howmedica Osteonics Corp dba Stryker Craniomaxillofacial|2
SYK|Orthovita, Inc., dBA Stryker Orthobiologics.|4
SYK|Stryker Biotech|3
SYK|Stryker Communications|15
SYK|Stryker Communications Corp|15
SYK|Stryker Communications, Inc.|1
SYK|Stryker Corporation|37
SYK|Stryker Craniomaxillofacial Division|7
SYK|Stryker Endoscopy|44
SYK|Stryker GmbH|21
SYK|Stryker Howmedica Osteonics|10
SYK|Stryker Howmedica Osteonics Corp.|174
SYK|Stryker Imaging|3
SYK|Stryker Instruments|1
SYK|Stryker Instruments Div. of Stryker Corporation|86
SYK|Stryker Instruments Division of Stryker Corporation|6
SYK|Stryker Instruments, Instruments Div.|4
SYK|Stryker Leibinger GmbH & Co. KG|8
SYK|Stryker Leibinger USA|2
SYK|Stryker Medical|7
SYK|Stryker Medical Div. of Stryker Corporation|16
SYK|Stryker Medical Division of Stryker Corporation|43
SYK|Stryker Neurovascular|23
SYK|Stryker Orthobiologics, Inc.|1
SYK|Stryker Orthopaedics|1
SYK|Stryker Spine|42
SYK|Stryker Sustainability Solutions|37
SYK|Stryker Sustainability Solutions, Inc.|1
SYK|Stryker, Inc.|1
SYY|Dito's - A Sysco Company|2
SYY|Sysco Atlanta, LLC|12
SYY|Sysco Charlotte|100
SYY|Sysco Corporation|11
SYY|Sysco Merchandising and Supply|12
TFX|Arrow International, Inc., Division of Teleflex Medical Inc.|2
TFX|Teleflex Creek Dr|2
TFX|TELEFLEX LLC|9
TFX|Teleflex Medical|107
TFX|Teleflex Medical Europe Ltd|5
TFX|TELEFLEX MEDICAL INC|12
TFX|Teleflex Medical, Inc.|1
TFX|TELEFLEX-MORRISVILLE|1
TFX|Teleflex, Inc.|3
TGT|Boston Scientific Target|7
TGT|Target Corporation|202
TMO|Thermo Fisher|1
TMO|Thermo Fisher Scientific|4
TMO|Thermo Fisher Scientific (Asheville) LLC|2
TMO|Thermo Fisher Scientific (Monterrey)|2
TNDM|Tandem Diabetes Care Inc|4
TNDM|Tandem Diabetes Care, Inc.|9
TSN|Tyson Foods Discovery Center|5
TSN|Tyson Foods, inc.|2
UNFI|United Natural Foods, Inc.|16
UNFI|United Natural Foods, Inc. - Greenwood|1
UTHR|United Therapeutics Corp.|3
UVV|Universal Meditech Inc.|2
VTRS|Viatris|2
VTRS|Viatris Inc|22
VTRS|Viatris, Inc.|2
WAT|DANONE WATERS OF AMERICA INC|1
WAT|Danone Waters of America, Inc|1
WAT|Natural Waters of Viti Limited|1
WAT|Nestle Waters North America|6
WAT|Rushing Waters Fisheries, LLC|3
WAT|Waters Medical Systems LLC|1
WAT|World Waters, LLC dba WTRMLN WTR|1
WMK|WEIS MARKETS|4
WMK|WEIS MARKETS, INC.|1
WMK|Weis Markets, Inc., Ice Cream Division|41
WMT|Walmart Inc|7
WMT|Walmart Stores|1
WST|West Pharmaceutical Services AZ, Inc.|1
ZBH|Zimmer Biomet Spine Inc.|3
ZBH|Zimmer Biomet Spine, Inc|2
ZBH|Zimmer Biomet, Inc.|144
`.trim().split("\n").map((l) => { const [ticker, firm, n] = l.split("|"); return { ticker, firm, n: Number(n) }; });

export const TRIAL_SPONSORS = `
ABBV|AbbVie|929
ABBV|AbbVie (prior sponsor, Abbott)|76
ABSI|Absci Pty Ltd.|1
ACAD|ACADIA Pharmaceuticals Inc.|41
ADPT|Adaptive Biotechnologies|8
AGIO|Agios Pharmaceuticals, Inc.|52
ALGN|Align Technology, Inc.|6
ALKS|Alkermes, Inc.|83
ALNY|Alnylam Pharmaceuticals|84
AMGN|Amgen|991
AMGN|Amgen Research (Munich) GmbH|10
AMLX|Amylyx Pharmaceuticals Inc.|13
AMPH|Amphastar Pharmaceuticals, Inc.|21
AMRX|Amneal Pharmaceuticals Co. India Private Limited|1
AMRX|Amneal Pharmaceuticals, LLC|13
ANIP|ANI Pharmaceuticals|1
AORT|CryoLife Europa|4
AORT|CryoLife, Inc.|9
ARQT|Arcutis Biotherapeutics, Inc.|26
ARWR|Arrowhead Pharmaceuticals|50
ATRC|AtriCure, Inc.|32
AXGN|Axogen Corporation|10
AXSM|Axsome Therapeutics, Inc.|37
BCRX|BioCryst Pharmaceuticals|54
BEAM|Beam Therapeutics Inc.|6
BFLY|Butterfly Network|1
BHVN|Biohaven Pharmaceuticals, Inc.|15
BHVN|Biohaven Therapeutics Ltd.|20
BIIB|Biogen|512
BIO|Bio-Rad Laboratories|2
BLCO|Bausch & Lomb GmbH|2
BLCO|Bausch & Lomb Incorporated|223
BLLN|BillionToOne Inc.|1
BMRN|BioMarin Pharmaceutical|112
BRKR|Bruker Daltonics|1
BRVE|Braveheart Bio, Inc.|1
BSX|Boston Scientific Corporation|538
BSX|Boston Scientific Japan K.K.|2
CAH|Cardinal Health|1
CAH|Cardinal Health 414, LLC|3
CDNA|CareDx|17
CELC|Celcuity Inc|5
CERT|Certara|1
CGON|CG Oncology, Inc.|8
CLDX|Celldex Therapeutics|45
CNMD|CONMED Corporation|2
CNMD|ConMed Linvatec Beijing|1
CNMD|Conmed Linvatec Benelux|1
CNMD|Conmed Pharmaceutical & Bio-Medical Corporation|1
COGT|Cogent Biosciences, Inc.|14
COLL|Collegium Pharmaceutical, Inc.|1
CORT|Corcept Therapeutics|73
CYTK|Cytokinetics|41
DFTX|Definium Therapeutics US, Inc.|8
DGX|Quest Diagnostics-Nichols Insitute|1
DNLI|Denali Therapeutics Inc.|19
DNTH|Dianthus Therapeutics|4
DVA|Davita Clinical Research|5
DXCM|DexCom, Inc.|35
DYN|Dyne Therapeutics|4
ELV|Elevance Health|1
ELVN|Enliven Therapeutics|5
ERAS|Erasca, Inc.|9
EW|Edwards Lifesciences|128
EWTX|Edgewise Therapeutics, Inc.|17
EXEL|Exelixis|57
GEHC|GE Healthcare|176
GENB|Generate Biomedicines|6
GH|Guardant Health, Inc.|10
GILD|Gilead Sciences|696
GKOS|Glaukos Corporation|67
GMED|Globus Medical Inc|16
GRAL|GRAIL, Inc.|8
HAE|Haemonetics Corporation|12
HALO|Halozyme Therapeutics|33
HCA|HCA Healthcare Research Institute|1
HNGE|Hinge Health, Inc|5
HTFL|HeartFlow, Inc.|12
HUM|Humana Co.Ltd.|1
HUM|Humana Inc.|1
ICUI|ICU Medical Technologies S.L.|1
IDYA|IDEAYA Biosciences|11
ILMN|Illumina, Inc.|12
IMNM|Immunome, Inc.|11
IMVT|Immunovant Sciences GmbH|19
INCY|Incyte Biosciences Benelux|1
INCY|Incyte BioSciences France|1
INCY|Incyte Biosciences International S?rl|10
INCY|Incyte Biosciences Italy S.r.l|1
INCY|Incyte Biosciences Japan GK|6
INCY|Incyte Biosciences UK|1
INCY|Incyte Corporation|288
INSM|Insmed Gene Therapy LLC|2
INSM|Insmed Incorporated|51
INSP|Inspire Medical Systems, Inc.|13
INVA|Innoviva Specialty Therapeutics|2
IONS|Ionis Pharmaceuticals, Inc.|118
IOVA|Iovance Biotherapeutics, Inc.|16
ISRG|Intuitive Surgical|62
JAZZ|Jazz Pharmaceuticals|206
JNJ|Johnson & Johnson (China) Investment Ltd.|2
JNJ|Johnson & Johnson Consumer and Personal Products Worldwide|60
JNJ|Johnson & Johnson Consumer Inc. (J&JCI)|55
JNJ|Johnson & Johnson Consumer Inc., McNeil Consumer Healthcare Division|7
JNJ|Johnson & Johnson Consumer Products Company Division of Johnson & Johnson Consumer Companies, Inc.|5
JNJ|Johnson & Johnson Enterprise Innovation Inc.|7
JNJ|Johnson & Johnson GmbH|1
JNJ|Johnson & Johnson Health and Wellness Solutions, Inc.|1
JNJ|Johnson & Johnson Healthcare Products Division of McNEIL-PPC, Inc.|5
JNJ|Johnson & Johnson International (Singapore) Pte. Ltd.|1
JNJ|Johnson & Johnson K.K. Medical Company|4
JNJ|Johnson & Johnson Medical (Shanghai) Ltd.|4
JNJ|Johnson & Johnson Medical (Suzhou) Ltd.|3
JNJ|Johnson & Johnson Medical, China|9
JNJ|Johnson & Johnson Pharmaceutical Research & Development, L.L.C.|455
JNJ|Johnson & Johnson Private Limited|9
JNJ|Johnson & Johnson Pte Ltd|1
JNJ|Johnson & Johnson Surgical Vision, Inc.|36
JNJ|Johnson & Johnson Taiwan Ltd|23
JNJ|Johnson & Johnson Vision Care, Inc.|221
KMTS|Kestra Medical Technologies, Inc.|3
KNSA|Kiniksa Pharmaceuticals International, plc|5
KOD|Kodiak Sciences Inc|12
KRYS|Krystal Biotech, Inc.|18
KYMR|Kymera Therapeutics, Inc.|12
LGND|Ligand Pharmaceuticals|21
LH|Labcorp Corporation of America Holdings, Inc|1
LIVN|LivaNova|40
LLY|Eli Lilly and Company|983
LMAT|LeMaitre Vascular|8
LQDA|Liquidia Technologies, Inc.|10
MANE|Veradermics, Inc.|5
MAZE|Maze Therapeutics|3
MBX|MBX Biosciences|8
MDLN|Medline Industries|39
MDT|Medtronic|42
MDT|Medtronic - MITG|179
MDT|Medtronic BRC|26
MDT|Medtronic Cardiac Ablation Solutions|37
MDT|Medtronic Cardiac Rhythm and Heart Failure|265
MDT|Medtronic Cardiac Surgery|11
MDT|Medtronic Cardiovascular|70
MDT|Medtronic Comercial Ltda.|1
MDT|Medtronic Corporate Technologies and New Ventures|4
MDT|Medtronic Diabetes R&D Denmark|3
MDT|Medtronic Endovascular|51
MDT|Medtronic France SAS|1
MDT|Medtronic Heart Valves|3
MDT|Medtronic Hellas Medical Devices ?EE|1
MDT|Medtronic Italia|4
MDT|Medtronic Latin America|1
MDT|Medtronic MiniMed, Inc.|74
MDT|Medtronic Neurovascular Clinical Affairs|32
MDT|Medtronic Spinal and Biologics|57
MDT|Medtronic Spine LLC|8
MDT|Medtronic Surgical Technologies|14
MDT|Medtronic Vascular|60
MDT|Medtronic Xomed, Inc.|2
MIRM|Mirum Pharmaceuticals, Inc.|40
MMSI|Merit Medical Systems, Inc.|29
MRK|Merck Healthcare KGaA, Darmstadt, Germany, an affiliate of Merck KGaA, Darmstadt, Germany|56
MRK|Merck KGaA, Darmstadt, Germany|29
MRK|Merck Sharp & Dohme LLC|801
NBIX|Neurocrine Biosciences|87
NHC|National Healthcare Center|1
NHC|National Healthcare Group Polyclinics|9
NHC|National Healthcare Group, Singapore|14
NRIX|Nurix Therapeutics, Inc.|10
NTLA|Intellia Therapeutics|9
NTRA|Natera, Inc.|36
NUVB|Nuvation Bio Inc.|19
NVAX|Novavax|47
ORKA|Oruka Therapeutics, Inc.|8
PBLS|Parabilis Medicines, Inc.|1
PCVX|Vaxcyte, Inc.|9
PEN|Penumbra Inc.|33
PFE|Pfizer|964
PGEN|Precigen Actobio T1D, LLC|1
PGEN|Precigen, Inc|6
PGNY|Progyny, Inc.|10
PLSE|Pulse Biosciences, Inc.|15
PODD|Insulet Corporation|23
PRAX|Praxis Precision Medicines|17
PSNL|Personalis Inc.|1
PTCT|PTC Therapeutics|65
PTGX|Protagonist Therapeutics, Inc.|13
PVLA|Palvella Therapeutics, Inc.|9
RARE|Ultragenyx Pharmaceutical Inc|63
RCUS|Arcus Biosciences, Inc.|32
RDNT|Radnet Management, Inc.|1
REGN|Regeneron Pharmaceuticals|412
RGEN|Repligen Corporation|6
RLAY|Relay Therapeutics, Inc.|5
RMD|ResMed|105
RVMD|Revolution Medicines, Inc.|20
RXRX|Recursion Pharmaceuticals Inc.|7
SEPN|Septerna, Inc.|2
SLS|Sellas Life Sciences Group|7
SMMT|Summit Therapeutics|13
SOLV|Solventum Orthodontics Corporation|2
SOLV|Solventum US LLC|64
SRPT|Sarepta Therapeutics, Inc.|52
STOK|Stoke Therapeutics, Inc|3
SUPN|Supernus Pharmaceuticals, Inc.|64
SYK|Stryker Australia Pty Ltd.|1
SYK|Stryker Biotech|3
SYK|Stryker Craniomaxillofacial|6
SYK|Stryker Endoscopy|4
SYK|Stryker GI Ltd.|1
SYK|Stryker Instruments|6
SYK|Stryker Japan K.K.|6
SYK|Stryker Neurovascular|25
SYK|Stryker Orthopaedics|44
SYK|Stryker South Pacific|5
SYK|Stryker Sustainability Solutions|4
SYK|Stryker Trauma and Extremities|43
SYRE|Spyre Therapeutics, Inc.|8
TARS|Tarsus Pharmaceuticals, Inc.|13
TDOC|Teladoc Health|2
TEM|Tempus AI|14
TFX|Teleflex|11
TGTX|TG Therapeutics, Inc.|40
THC|Tenet Healthcare Corporation|1
TMO|Thermo Fisher Scientific Oy|1
TMO|Thermo Fisher Scientific, Inc|2
TNDM|Tandem Diabetes Care, Inc.|18
TNGX|Tango Therapeutics, Inc.|7
TRVI|Trevi Therapeutics|17
TVTX|Travere Therapeutics, Inc.|14
UNH|UnitedHealth Group|7
UTHR|United Therapeutics|85
VCEL|Vericel Corporation|14
VCYT|Veracyte, Inc.|1
VERA|Vera Therapeutics, Inc.|6
VIR|Vir Biotechnology, Inc.|22
VKTX|Viking Therapeutics, Inc.|13
VRTX|Vertex Pharmaceuticals Incorporated|249
VTRS|Viatris Inc.|7
VTRS|Viatris Innovation GmbH|24
VTRS|Viatris Korea|1
VTRS|Viatris Pharmaceuticals Co., Ltd.|1
VTRS|Viatris Pharmaceuticals Japan Inc|1
VTRS|Viatris Specialty LLC|5
XNCR|Xencor, Inc.|30
XRAY|Dentsply Sirona Implants and Consumables|36
ZBH|Zimmer Biomet|275
ZBIO|Zenas BioPharma (USA), LLC|10
ZYME|Zymeworks BC Inc.|4
`.trim().split("\n").map((l) => { const [ticker, firm, n] = l.split("|"); return { ticker, firm, n: Number(n) }; });

export const SHORT_NAMES: Record<string, string> = {"A": "Agilent Technologies", "ABBV": "AbbVie", "ABSI": "Absci", "ABT": "Abbott", "ACAD": "Acadia Pharmaceuticals", "ACI": "Albertsons Companies", "ADM": "Archer Daniels Midland", "ADPT": "Adaptive Biotechnologies", "AGIO": "Agios Pharmaceuticals", "ALGN": "Align Technology", "ALKS": "Alkermes plc.", "ALNY": "Alnylam Pharmaceuticals", "AMGN": "Amgen", "AMLX": "Amylyx Pharmaceuticals", "AMPH": "Amphastar Pharmaceuticals", "AMRX": "Amneal Pharmaceuticals", "ANIP": "Ani Pharmaceuticals", "AORT": "CryoLife", "ARQT": "Arcutis Biotherapeutics", "ARWR": "Arrowhead Pharmaceuticals", "ATRC": "AtriCure", "AVTR": "Avantor", "AXGN": "Axogen", "AXSM": "Axsome Therapeutics", "BCRX": "BioCryst Pharmaceuticals", "BDX": "Becton Dickinson", "BEAM": "Beam Therapeutics", "BFLY": "Butterfly Network", "BHVN": "Biohaven", "BIIB": "Biogen", "BIO": "Bio-Rad Laboratories", "BLCO": "Bausch & Lomb", "BLLN": "BillionToOne", "BMRN": "BioMarin Pharmaceutical", "BMY": "Bristol Myers Squibb", "BRKR": "Bruker", "BRVE": "Braveheart Bio", "BSX": "Boston Scientific", "CAG": "Conagra Brands", "CAH": "Cardinal Health", "CAI": "Caris Life Sciences", "CALM": "Cal-Maine", "CASY": "Casey's", "CDNA": "CareDx", "CELC": "Celcuity", "CERT": "Certara", "CGON": "CG Oncology", "CHD": "Church & Dwight", "CHEF": "Chefs' Warehouse", "CL": "Colgate-Palmolive", "CLDX": "Celldex Therapeutics", "CLX": "Clorox", "CNMD": "Conmed", "COGT": "Cogent Biosciences", "COKE": "Coca-Cola Consolidated", "COLL": "Collegium Pharmaceutical", "CORT": "Corcept Therapeutics", "COST": "Costco", "CVS": "CVS Health", "CYTK": "Cytokinetics", "DFTX": "Definium Therapeutics", "DG": "Dollar General", "DGX": "Quest Diagnostics", "DLTR": "Dollar Tree", "DNLI": "Denali Therapeutics", "DNTH": "Dianthus Therapeutics, Inc. /DE/", "DVA": "DaVita", "DXCM": "Dexcom", "DYN": "Dyne Therapeutics", "ELV": "Elevance Health", "ELVN": "Enliven Therapeutics", "EPC": "Edgewell Personal Care", "ERAS": "Erasca", "EW": "Edwards Lifesciences", "EWTX": "Edgewise Therapeutics", "EXEL": "Exelixis", "FLO": "Flowers Foods", "GE": "GE Aerospace", "GEHC": "GE HealthCare", "GENB": "Generate Biomedicines", "GH": "Guardant Health", "GILD": "Gilead Sciences", "GIS": "General Mills", "GKOS": "Glaukos", "GMED": "Globus Medical", "GRAL": "Grail", "GRDN": "Guardian Pharmacy Services", "HAE": "Haemonetics", "HALO": "Halozyme Therapeutics", "HCA": "HCA Healthcare", "HNGE": "Hinge Health", "HON": "Honeywell", "HRL": "Hormel Foods", "HSIC": "Henry Schein", "HTFL": "Heartflow", "HUM": "Humana", "ICUI": "ICU Medical", "IDYA": "IDEAYA Biosciences", "ILMN": "Illumina", "IMKTA": "Ingles", "IMNM": "Immunome", "IMVT": "Immunovant", "INCY": "Incyte", "INGR": "Ingredion", "INSM": "Insmed", "INSP": "Inspire Medical Systems", "INVA": "Innoviva", "IONS": "Ionis Pharmaceuticals", "IOVA": "Iovance Biotherapeutics", "ISRG": "Intuitive Surgical", "JAZZ": "Jazz Pharmaceuticals", "JNJ": "Johnson & Johnson", "KDP": "Keurig Dr Pepper", "KHC": "Kraft Heinz", "KMB": "Kimberly-Clark", "KMTS": "Kestra Medical Technologies", "KNSA": "Kiniksa Pharmaceuticals International", "KO": "Coca-Cola", "KOD": "Kodiak Sciences", "KR": "Kroger", "KRYS": "Krystal Biotech", "KVUE": "Kenvue", "KYMR": "Kymera Therapeutics", "LGND": "Ligand Pharmaceuticals", "LH": "Labcorp", "LIVN": "LivaNova", "LLY": "Eli Lilly", "LMAT": "Lemaitre Vascular", "LQDA": "Liquidia", "MANE": "Veradermics", "MAZE": "Maze Therapeutics", "MBX": "MBX Biosciences", "MCK": "McKesson", "MDLN": "Medline", "MDLZ": "Mondelez", "MDT": "Medtronic", "MIRM": "Mirum Pharmaceuticals", "MKC": "McCormick &", "MMSI": "Merit Medical Systems", "MRK": "Merck", "MZTI": "T. Marzetti", "NBIX": "Neurocrine Biosciences", "NEOG": "NeoGen", "NHC": "National Healthcare", "NRIX": "Nurix Therapeutics", "NTLA": "Intellia Therapeutics", "NTRA": "Natera", "NUVB": "Nuvation Bio", "NVAX": "Novavax", "OGN": "Organon &", "OMCL": "Omnicell", "ORKA": "Oruka Therapeutics", "PBH": "Prestige Consumer Healthcare", "PBLS": "Parabilis Medicines", "PCVX": "Vaxcyte", "PEN": "Penumbra", "PEP": "PepsiCo", "PFE": "Pfizer", "PFGC": "Performance Food Group", "PG": "Procter & Gamble", "PGEN": "Precigen", "PGNY": "Progyny", "PLSE": "Pulse Biosciences", "PODD": "Insulet", "PRAX": "Praxis Precision Medicines", "PSNL": "Personalis", "PTCT": "PTC Therapeutics", "PTGX": "Protagonist Therapeutics", "PVLA": "Palvella Therapeutics", "QDEL": "QuidelOrtho", "RARE": "Ultragenyx Pharmaceutical", "RCUS": "Arcus Biosciences", "RDNT": "RadNet", "REGN": "Regeneron Pharmaceuticals", "RGEN": "Repligen", "RLAY": "Relay Therapeutics", "RMD": "ResMed", "RVMD": "Revolution Medicines", "RXRX": "Recursion Pharmaceuticals", "SEB": "Seaboard Corp /De/", "SEPN": "Septerna", "SFM": "Sprouts Farmers Market", "SLS": "SELLAS Life Sciences Group", "SMMT": "Summit Therapeutics", "SMPL": "Simply Good Foods", "SOLV": "Solventum", "SRPT": "Sarepta Therapeutics", "STE": "Steris", "STOK": "Stoke Therapeutics", "SUPN": "Supernus", "SYK": "Stryker", "SYRE": "Spyre Therapeutics", "SYY": "Sysco", "TARS": "Tarsus Pharmaceuticals", "TDOC": "Teladoc Health", "TEM": "Tempus AI", "TFX": "Teleflex", "TGT": "Target", "TGTX": "TG Therapeutics", "THC": "Tenet Healthcare", "TMO": "Thermo Fisher", "TNDM": "Tandem Diabetes Care", "TNGX": "Tango Therapeutics", "TRVI": "Trevi Therapeutics", "TSN": "Tyson Foods", "TVTX": "Travere Therapeutics", "UNFI": "United Natural Foods", "UNH": "UnitedHealth", "UTHR": "United Therapeutics", "UVV": "Universal", "VCEL": "Vericel", "VCYT": "Veracyte", "VERA": "Vera Therapeutics", "VIR": "Vir Biotechnology", "VKTX": "Viking Therapeutics", "VRTX": "Vertex Pharmaceuticals", "VTRS": "Viatris", "WAT": "Waters", "WMK": "Weis Markets", "WMT": "Walmart", "WST": "West Pharmaceutical Services", "XNCR": "Xencor", "XRAY": "Dentsply Sirona", "ZBH": "Zimmer Biomet", "ZBIO": "Zenas BioPharma", "ZYME": "Zymeworks"};
