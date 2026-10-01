# Historical ungraded search retrieval diagnostic

**Historical diagnostic only.** This run queried Qdrant directly without the production 0.55 threshold. Its “precision” was automatic term overlap, not a human relevance grade; a vector candidate only meant that Qdrant returned a point. For example, “santé mentale” returned an unrelated French-immersion flag. Do not use the 93% figure or candidate labels as evidence of search quality. See the [production-endpoint check](search-production-evaluation.md).

**Date:** 2026-10-01 · **Queries Tested:** 112

## 1. Executive Summary: Lexical vs. Qdrant Vector vs. AI Expansion

| Metric | Lexical (Standard) | Qdrant Vector (Pilot) | Target Threshold |
| :--- | :---: | :---: | :---: |
| **Exact Mnemonic Accuracy** | **90%** | **0%** | 100% (Lexical preserves this) |
| **Unreviewed term overlap @ Top 5** | **49%** | **93%** | Human grading required |
| **Average Latency** | **240 ms** | **200 ms** | < 400 ms |
| **p95 Latency** | **799 ms** | **319 ms** | < 1200 ms |
| **Zero-Result Rate (non-controls)** | **42 / 100** | **0 / 100** | Minimized |

## 2. Head-to-Head Retrieval by Query

| ID | Category | Theme | Query | Lexical Hits | Vector Top Hit | Status |
| :--- | :--- | :--- | :--- | :---: | :--- | :--- |
| `hlt-01` | theme_content | Health | `self-rated general health` | 15 | `SRH_110` (Self-rated general health...) | ✅ OK |
| `hlt-02` | theme_content | Health | `chronic condition diagnosis` | 106 | `LOP_050` (Chronic condition...) | ✅ OK |
| `hlt-03` | theme_content | Health | `mental health depression anxiety` | 2 | `CCC_166B` (Mental health condition - anxiety...) | ✅ OK |
| `hlt-04` | theme_content | Health | `physical activity frequency` | 18 | `PACDFR` (Frequency of all leisure physical a...) | ✅ OK |
| `hlt-05` | theme_content | Health | `alcohol consumption binge drinking` | 0 | `SUBDVALB` (Binge drinking during pregnancy - f...) | Vector candidate (ungraded: SUBDVALB) |
| `hlt-06` | theme_content | Health | `unmet healthcare needs wait times` | 0 | `UCNWHYD` (Unmet health care needs - waiting t...) | Vector candidate (ungraded: UCNWHYD) |
| `lab-01` | theme_content | Labour | `telework remote work` | 1 | `EMO_02B` (Work-Telework available...) | ✅ OK |
| `lab-02` | theme_content | Labour | `hourly wage usual earnings` | 0 | `HRLYEARN` (Usual hourly earnings...) | Vector candidate (ungraded: HRLYEARN) |
| `lab-03` | theme_content | Labour | `union status collective agreement` | 0 | `UNIONCA` (Union status...) | Vector candidate (ungraded: UNIONCA) |
| `lab-04` | theme_content | Labour | `unemployment duration looking for work` | 0 | `DURUNEMP` (Duration of unemployment...) | Vector candidate (ungraded: DURUNEMP) |
| `lab-05` | theme_content | Labour | `shift work night schedule` | 6 | `LFP_Q05C` (...) | ✅ OK |
| `lab-06` | theme_content | Labour | `involuntary part-time employment` | 1 | `INVOLPT` (Identification of involuntary part-...) | ✅ OK |
| `inc-01` | theme_content | Income, pensions, spending and wealth | `household total income` | 800 | `DEM_D04` (Total household income...) | ✅ OK |
| `inc-02` | theme_content | Income, pensions, spending and wealth | `food security hunger` | 0 | `DCOPHUN3` (...) | Vector candidate (ungraded: DCOPHUN3) |
| `inc-03` | theme_content | Income, pensions, spending and wealth | `guaranteed income supplement pension` | 192 | `OASGI_R` (Old Age Security pension and Guaran...) | ✅ OK |
| `inc-04` | theme_content | Income, pensions, spending and wealth | `registered retirement savings plan` | 208 | `RDSP` (Registered Disability Savings Plan...) | ✅ OK |
| `inc-05` | theme_content | Income, pensions, spending and wealth | `out-of-pocket prescription medication cost` | 0 | `MEU_50A` (Prescription - out of pocket cost -...) | Vector candidate (ungraded: MEU_50A) |
| `inc-06` | theme_content | Income, pensions, spending and wealth | `low-income measure poverty` | 0 | `LOLIMMIL` (Low-income measure, market income...) | Vector candidate (ungraded: LOLIMMIL) |
| `dig-01` | theme_content | Digital economy and society | `online shopping e-commerce` | 0 | `DUR263` (Duration - Online shopping for good...) | Vector candidate (ungraded: DUR263) |
| `dig-02` | theme_content | Digital economy and society | `artificial intelligence adoption business` | 0 | `AI05004` (Artificial Intelligence technologie...) | Vector candidate (ungraded: AI05004) |
| `dig-03` | theme_content | Digital economy and society | `cyberbullying online harassment` | 0 | `CBU_110` (Cyber bullying - Threatening, aggre...) | Vector candidate (ungraded: CBU_110) |
| `dig-04` | theme_content | Digital economy and society | `home high-speed internet access` | 0 | `AC_070D` (Reasons not to have a high speed In...) | Vector candidate (ungraded: AC_070D) |
| `dig-05` | theme_content | Digital economy and society | `smartphone mobile banking` | 0 | `FRQ_01L` (Usage and knowledge of method - Usi...) | Vector candidate (ungraded: FRQ_01L) |
| `hou-01` | theme_content | Housing | `core housing need affordability` | 0 | `CHNS` (Core housing need...) | Vector candidate (ungraded: CHNS) |
| `hou-02` | theme_content | Housing | `monthly rent tenant shelter cost` | 0 | `SCR_55` (Shelter costs for renters - $ month...) | Vector candidate (ungraded: SCR_55) |
| `hou-03` | theme_content | Housing | `homeownership mortgage payment` | 0 | `SH056_B` (Property taxes included in mortgage...) | Vector candidate (ungraded: SH056_B) |
| `hou-04` | theme_content | Housing | `dwelling type single detached apartment` | 157 | `CESINGD` (Single-detached houses - as a % of ...) | ✅ OK |
| `hou-05` | theme_content | Housing | `number of bedrooms overcrowding` | 0 | `BEDRM` (Number of bedrooms...) | Vector candidate (ungraded: BEDRM) |
| `edu-01` | theme_content | Education, training and learning | `highest level of educational attainment` | 122 | `EDUC` (Highest educational attainment...) | ✅ OK |
| `edu-02` | theme_content | Education, training and learning | `major field of study classification` | 8 | `DMFS11` (Major field of study...) | ✅ OK |
| `edu-03` | theme_content | Education, training and learning | `student debt loans government` | 14 | `STULOANS` (Received government-sponsored stude...) | ✅ OK |
| `edu-04` | theme_content | Education, training and learning | `adult job-related training courses` | 0 | `ETR_06` (Training-Wanted work-related traini...) | Vector candidate (ungraded: ETR_06) |
| `edu-05` | theme_content | Education, training and learning | `apprenticeship trade certification` | 91 | `A29B` (...) | ✅ OK |
| `crm-01` | theme_content | Crime and justice | `victim of violent crime assault` | 0 | `VVIC_12` (Violent Victimization (12 ms.) - Re...) | Vector candidate (ungraded: VVIC_12) |
| `crm-02` | theme_content | Crime and justice | `perception of neighborhood safety night` | 0 | `NS_05` (Neighbourhood safety - At night or ...) | Vector candidate (ungraded: NS_05) |
| `crm-03` | theme_content | Crime and justice | `incident reported to police` | 250 | `RIP_70` (Reported to police - Warn others...) | ✅ OK |
| `crm-04` | theme_content | Crime and justice | `spousal violence intimate partner` | 0 | `EX5RRPRT` (Spousal violence by ex-spouse/partn...) | Vector candidate (ungraded: EX5RRPRT) |
| `imm-01` | theme_content | Immigration and ethnocultural diversity | `landed immigrant year of arrival` | 53 | `IMG_LDYR` (Year became a landed immigrant...) | ✅ OK |
| `imm-02` | theme_content | Immigration and ethnocultural diversity | `visible minority population group` | 35 | `VISMIN` (Visible minority population group...) | ✅ OK |
| `imm-03` | theme_content | Languages | `mother tongue first language` | 146 | `LAN_C04C` (Mother tongue - Other language...) | ✅ OK |
| `imm-04` | theme_content | Languages | `knowledge of official languages English French` | 65 | `LAN_01` (Knowledge of official languages (En...) | ✅ OK |
| `imm-05` | theme_content | Immigration and ethnocultural diversity | `experience of discrimination` | 131 | `DISCRM2Y` (Experienced discrimination in past ...) | ✅ OK |
| `ind-01` | theme_content | Indigenous peoples | `First Nations Status Indian` | 17 | `AMBP_02A` (First Nations (North American India...) | ✅ OK |
| `ind-02` | theme_content | Indigenous peoples | `Metis identity membership` | 0 | `ID_25` (Indigenous identification - Registe...) | Vector candidate (ungraded: ID_25) |
| `ind-03` | theme_content | Indigenous peoples | `Inuit Inuk identity Nunangat` | 0 | `DIID_B` (Indigenous Identity - Inuk (Inuit)...) | Vector candidate (ungraded: DIID_B) |
| `ind-04` | theme_content | Indigenous peoples | `Indigenous language spoken at home` | 10 | `HLOIN_R` (Indigenous language spoken at home ...) | ✅ OK |
| `fam-01` | theme_content | Children and youth | `child care arrangement day care` | 42 | `CCR_08C` (Regular child care arrangement - Da...) | ✅ OK |
| `fam-02` | theme_content | Families, households and marital status | `parental leave maternity benefits` | 0 | `MATPAR` (Received maternity and/or parental ...) | Vector candidate (ungraded: MATPAR) |
| `fam-03` | theme_content | Families, households and marital status | `lone-parent family single mother` | 0 | `DEMDV04` (Does the child live in a single-par...) | Vector candidate (ungraded: DEMDV04) |
| `fam-04` | theme_content | Families, households and marital status | `legal marital status common-law` | 8 | `MARST` (Marital status (legal)...) | ✅ OK |
| `age-01` | theme_content | Older adults and population aging | `retirement age plans` | 388 | `PVCXNREP` (Normal retirement age...) | ✅ OK |
| `age-02` | theme_content | Older adults and population aging | `informal caregiving for senior` | 0 | `CGSC_Q10` (Caregiving: Provide care - Problems...) | Vector candidate (ungraded: CGSC_Q10) |
| `age-03` | theme_content | Older adults and population aging | `cognitive decline memory loss` | 0 | `CHS_05AD` (Long-term health symptom - Confusio...) | Vector candidate (ungraded: CHS_05AD) |
| `age-04` | theme_content | Older adults and population aging | `mobility limitations walking climbing stairs` | 0 | `DSQ_11` (Mobility - Difficulty walking up or...) | Vector candidate (ungraded: DSQ_11) |
| `trn-01` | theme_content | Transportation | `commute to work public transit` | 4 | `CTW_180` (Commute to work/school - Convenienc...) | ✅ OK |
| `trn-02` | theme_content | Transportation | `commuting travel time minutes` | 0 | `PWDUR_R` (Commuting duration - R...) | Vector candidate (ungraded: PWDUR_R) |
| `trn-03` | theme_content | Transportation | `passenger vehicle ownership` | 0 | `OWNRV` (Owned or operated a recreational ve...) | Vector candidate (ungraded: OWNRV) |
| `env-01` | theme_content | Environment | `household energy conservation heat pump` | 0 | `D07` (...) | Vector candidate (ungraded: D07) |
| `env-02` | theme_content | Environment | `extreme weather wildfire smoke evacuation` | 0 | `PED_02AJ` (Emergency type - Wildfire or forest...) | Vector candidate (ungraded: PED_02AJ) |
| `env-03` | theme_content | Environment | `drinking water quality boil water advisory` | 0 | `WA_Q04BC` (Water treatment due to boil water a...) | Vector candidate (ungraded: WA_Q04BC) |
| `bus-01` | theme_content | Science and technology | `business research development expenditures` | 1 | `C270105` (Question 30E; Expenditures on innov...) | ✅ OK |
| `bus-02` | theme_content | Business performance and ownership | `supply chain disruption delays` | 0 | `EC_100C` (Problem ordering online – Speed of ...) | Vector candidate (ungraded: EC_100C) |
| `bus-03` | theme_content | International trade | `international export sales destination` | 0 | `C470001` (Question 50; Imports and exports...) | Vector candidate (ungraded: C470001) |
| `agr-01` | theme_content | Agriculture and food | `total farm operating revenue` | 0 | `FMNET` (Net farming income...) | Vector candidate (ungraded: FMNET) |
| `agr-02` | theme_content | Agriculture and food | `crop livestock production acreage` | 0 | `EFFMSE` (Farm self-employment net income inc...) | Vector candidate (ungraded: EFFMSE) |
| `soc-01` | theme_content | Society and community | `sense of belonging local community` | 59 | `SBL_100` (Sense of belonging - Local communit...) | ✅ OK |
| `soc-02` | theme_content | Society and community | `volunteer work unpaid activities` | 5 | `FVL_005` (Unpaid volunteer activities - youth...) | ✅ OK |
| `soc-03` | theme_content | Society and community | `trust in institutions police courts` | 0 | `CII_15` (Confidence in institutions - Justic...) | Vector candidate (ungraded: CII_15) |
| `mnem-01` | exact_mnemonic | - | `DHH_AGE` | 1,886 | `AGE_IN_YEARS` (Age in years...) | ✅ Rank 1 (Lex) |
| `mnem-02` | exact_mnemonic | - | `LFS_STAT` | 0 | `ASSRIF_O` (Value of RRIFs, AND LIFs and/or LRI...) | ❌ Missed Rank 1 |
| `mnem-03` | exact_mnemonic | - | `WTS_M` | 34 | `M5_C09` (...) | ✅ Rank 1 (Lex) |
| `mnem-04` | exact_mnemonic | - | `VERDATE` | 224 | `HR_TOT` (Répondant a vécu, vu, ou entendu un...) | ✅ Rank 1 (Lex) |
| `mnem-05` | exact_mnemonic | - | `GEN_01` | 108 | `GENST_P1` (Generation status: Summary - P1...) | ✅ Rank 1 (Lex) |
| `mnem-06` | exact_mnemonic | - | `MARSTAT` | 715 | `FD387` (Pistachios...) | ✅ Rank 1 (Lex) |
| `mnem-07` | exact_mnemonic | - | `PR` | 1,866 | `PS4_35G` (No con. after con. - Pptrator - Pri...) | ✅ Rank 1 (Lex) |
| `mnem-08` | exact_mnemonic | - | `GEO_PRV` | 33 | `CPROV` (GEO from Postal code...) | ✅ Rank 1 (Lex) |
| `mnem-09` | exact_mnemonic | - | `C13A` | 4 | `LAB_BTCE` (1,1,2-Trichloroethylene (ng/mL)...) | ✅ Rank 1 (Lex) |
| `mnem-10` | exact_mnemonic | - | `REGISTID` | 2 | `PERSONID` (Person ID...) | ✅ Rank 1 (Lex) |
| `hist-01` | historical_term | - | `aboriginal` | 3,617 | `ABORIGINAL_EVER_FLAG` (Aboriginal...) | ✅ OK |
| `hist-02` | historical_term | - | `indigenous` | 3,617 | `INDGID` (Indigenous group...) | ✅ OK |
| `hist-03` | historical_term | - | `marijuana` | 1,363 | `DRG_01` (Use of cannabis or marijuana...) | ✅ OK |
| `hist-04` | historical_term | - | `cannabis` | 1,363 | `HC063` (Cannabis for medical use...) | ✅ OK |
| `hist-05` | historical_term | - | `elderly` | 919 | `SENFLAG` (Seniors (age 65 and over) in househ...) | ✅ OK |
| `hist-06` | historical_term | - | `wfh` | 81 | `HHFDITX` (HH - Federal income tax...) | ✅ OK |
| `hist-07` | historical_term | - | `vaping` | 359 | `VAP_35` (Main reason for vaping - currently...) | ✅ OK |
| `hist-08` | historical_term | - | `coronavirus` | 1,758 | `CHCDCAT4` (Long-term health conditions - Prior...) | ✅ OK |
| `col-01` | colloquial | - | `feeling sad or down` | 66 | `MDE_01A` (Feeling sad/depressed/down/annoyed ...) | ✅ OK |
| `col-02` | colloquial | - | `working from home` | 420 | `INE_41A` (Facilitators of employment - Abilit...) | ✅ OK |
| `col-03` | colloquial | - | `pay stub earnings` | 0 | `EFEARNG` (Earnings....) | Vector candidate (ungraded: EFEARNG) |
| `col-04` | colloquial | - | `living alone` | 77 | `LHH_310Y` (Year last left home to live alone...) | ✅ OK |
| `col-05` | colloquial | - | `getting laid off` | 8 | `NRLG_25E` (NU Supp - Stop working for governme...) | ✅ OK |
| `col-06` | colloquial | - | `buying groceries food budget` | 0 | `REM_06A1` (Living expense - Groceries or food...) | Vector candidate (ungraded: REM_06A1) |
| `col-07` | colloquial | - | `taking care of elderly parents` | 0 | `I06B_06` (...) | Vector candidate (ungraded: I06B_06) |
| `col-08` | colloquial | - | `working night shifts` | 12 | `LFS_Q05C` (...) | ✅ OK |
| `haz-01` | noise_hazard | - | `supervisor` | 363 | `SUPDVINC` (Supervisor - Incivility...) | ✅ OK |
| `haz-02` | noise_hazard | - | `safety` | 285 | `SFC_30` (Crime safety - Plan route with safe...) | ✅ OK |
| `haz-03` | noise_hazard | - | `director` | 5 | `DEPT` (Department or agency...) | ✅ OK |
| `haz-04` | noise_hazard | - | `repair` | 304 | `EPI21` (Occurences of - Repair, painting, r...) | ✅ OK |
| `haz-05` | noise_hazard | - | `assistant` | 1,945 | `EEDV_96` (Assistant Deputy Ministers...) | ✅ OK |
| `haz-06` | noise_hazard | - | `retail sales` | 97 | `EPI37` (Occurences of - Shopping or buying ...) | ✅ OK |
| `fra-01` | cross_lingual | - | `santé mentale` | 0 | `FRENCH_IMM_IN_YEAR_FLAG` (French immesion...) | Vector candidate (ungraded: FRENCH_IMM_IN_YEAR_FLAG) |
| `fra-02` | cross_lingual | - | `revenu du ménage` | 0 | `HR_TOT` (Répondant a vécu, vu, ou entendu un...) | Vector candidate (ungraded: HR_TOT) |
| `fra-03` | cross_lingual | - | `télétravail` | 0 | `C590001` (Telework option for employees...) | Vector candidate (ungraded: C590001) |
| `fra-04` | cross_lingual | - | `garde d'enfants` | 0 | `HR_TOT` (Répondant a vécu, vu, ou entendu un...) | Vector candidate (ungraded: HR_TOT) |
| `fra-05` | cross_lingual | - | `logement abordable` | 0 | `ACCPTBLH` (Logement acceptable...) | Vector candidate (ungraded: ACCPTBLH) |
| `fra-06` | cross_lingual | - | `premières nations` | 0 | `TRBER_P2` (Nation - P2...) | Vector candidate (ungraded: TRBER_P2) |
| `fra-07` | cross_lingual | - | `consommation d'alcool` | 0 | `ALC_25G` (Increased use of alcohol, reasons: ...) | Vector candidate (ungraded: ALC_25G) |
| `fra-08` | cross_lingual | - | `situation d'emploi` | 0 | `SDQDEMO` (Emotional Problems - (D)...) | Vector candidate (ungraded: SDQDEMO) |
| `ctrl-01` | control | - | `quantum blockchain surgery` | 0 | `C630006` (Question 63...) | ✅ Clean |
| `ctrl-02` | control | - | `extraterrestrial contact` | 0 | `HL2Q259` (...) | ✅ Clean |
| `ctrl-03` | control | - | `asdfghjkl123` | 0 | `CUBN1125` (rs11254363 - Cubilin...) | ✅ Clean |
| `ctrl-04` | control | - | `intergalactic warp drive propulsion` | 0 | `EPI871` (...) | ✅ Clean |
