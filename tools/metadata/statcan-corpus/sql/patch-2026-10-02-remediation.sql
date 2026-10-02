-- =====================================================================
-- Remediation Patch: 2026-10-02
-- Targets:
-- 1. Unsuppress 497 false-positive process variables:
--    - 254 CCHS Wait Times variables (remove WTM_ from weight prefix)
--    - 33 ACS/APS Indigenous family questions (restrict ^I[0-9]+$ to 4+ digits)
--    - 210 mental health screener flags (prioritize derivation before flag)
-- 2. Suppress 20 leaking weights (add WGT_, FWGT_, WEIGHTH, weights?)
-- 3. Deploy 28 academic search aliases
-- =====================================================================

-- 1. Updated corpus_variable_role function
create or replace function corpus_variable_role(
  p_name text,
  p_concept text default null,
  p_note text default null,
  p_survey_group text default null,
  p_question_text text default null
) returns text
language plpgsql
immutable
as $$
declare
  v_name text := upper(trim(coalesce(p_name, '')));
  v_concept text := coalesce(p_concept, '');
  v_note text := coalesce(p_note, '');
  v_survey_group text := upper(trim(coalesce(p_survey_group, '')));
  v_question text := coalesce(p_question_text, '');
  v_is_meth boolean := false;
  v_is_adm_process boolean := false;
  v_is_substantive_flag boolean := false;
begin
  if v_name = '' then
    return 'unclassified';
  end if;

  -- Guard methamphetamine / amphetamine from false MET_ match
  if (v_concept ~* '(methamphetamine|m[eé]thamph[eé]tamine|amphetamine)' or
      v_question ~* '(methamphetamine|m[eé]thamph[eé]tamine|amphetamine)') then
    v_is_meth := true;
  end if;

  -- Guard ADM_: only treat as process if survey is CCHS, or if name is clearly administrative (ADM_STATUS etc.)
  if (v_name ~* '^ADM_[A-Z]' or (v_name ~* '^ADM_' and v_survey_group ~* '^CCHS')) then
    v_is_adm_process := true;
  end if;

  -- Guard clinical screener flags and substance use indicators carrying (F)
  if (v_note ~* '^(based on|derived from|calcul[eé]|selon|compos[eé])' or
      v_concept ~* '\b(screener|suicide|bipolar|substance|cannabis|cocaine|heroin)\b') then
    v_is_substantive_flag := true;
  end if;

  -- 1. Process variables (weights, paradata, interview admin, imputation flags)
  -- NOTE: WTM_ removed (CCHS Wait Times module); ^I[0-9]+$ restricted to 4+ digits (protects APS I01-I27)
  if not v_is_meth and (
    v_name ~* '^(WTPM|WTMP|WTHM|FINALWT|WGT|WEIGHT|WEIGHTH)$'
    or v_name ~* '^(WTS?_|WT_|WGHT|BOOT|BSW|FWT|REPWT|FWEIGHT|HWEIGHT|WT[0-9]+|WTBS|WTPS|WVCBS|SPFWT|BWT|WGT_|FWGT_)'
    or v_name ~* '^(SAMPLEID|PERSONID|MASTERID|HHID|RECID|VERDATE|REFPER|RECORDID|CASEID|USERID|FORMID|PUMFID|BATCHID|STRAT|FRAME|SEQNUM|IDENT)'
    or v_name ~* '^DO[A-Z]{3}$'
    or v_name ~* '^(SAM_|INT_|COL_|SURV|DOF|FLG|FLAG|IF_|QFLG_)'
    or (v_name ~* '^I[0-9]{4,}$' and v_concept !~* '(immigra|citizen|born)')
    or (v_name ~* '^IMP[0-9]+' and v_concept !~* '(immigra|citizen|born)')
    or (v_name ~* '^IMP_' and v_concept !~* '(immigra|citizen|born)')
    or v_is_adm_process
    or (not v_is_substantive_flag and v_concept ~* '([-–—]\s*\(F\)$|\(F\)$)')
    or v_concept ~* '\b(sampling weight|sample weight|bootstrap|poids [eé]chantillon|share weight|master weight|survey weights?|final weight|replicate weights?|poids r[eé]plique|inclusion flag|imputation flag|imputation|allocation flag|quality flag|data quality flag|status flag|edit flag|indicateur d[''’]imputation|drapeau d[''’]imputation|indicateur)\b'
    or v_concept ~* '^imputation\b'
    or v_name ~* '(_F|_FLG|_FLAG|FL[0-9]*)$'
    or v_name ~* '^(STATUS|SNAICS|INSTANCE|CONTACT|COLDATE)$'
    or v_note ~* '\b(imputation flag|indicateur d[''’]imputation)\b'
    or v_question ~* '\b(imputation flag|indicateur d[''’]imputation|is imputed|sont imput[eé]e?s?)\b'
    or v_question ~* '^imputation\b'
  ) then
    return 'process';
  end if;

  -- 2. Administrative linkage variables
  if (
    v_concept ~* '\b(T1FF|CRA|IMDB|vital statistics|health administrative|hospital discharge|tax data|administrative file|donn[eé]es fiscales|registre)\b'
    or v_note ~* '\b(T1FF|CRA|IMDB|vital statistics|health administrative|hospital discharge|tax data|administrative file|donn[eé]es fiscales|registre)\b'
    or v_survey_group ~* '(VITAL|TAX|T1FF)'
    or v_name ~* '^GEO'
    or v_concept ~* '\b(province|postal code)\b'
  ) then
    return 'administrative';
  end if;

  -- 3. Derived variables
  if (
    v_concept ~* '(\s*-\s*\(D\)$|\(D\)$|\s*-\s*D$|\(derived\)$|\bderived variable\b|\bvariable d[eé]riv[eé]e\b)'
    or v_concept ~* '(?:^|\b)(?:DV\s*[-–—:]|derived variable|variable d[eé]riv[eé]e|\(D\)|\(G\)|grouped|group[eé]e?s?)|[-–—]\s*(?:derived|\(D\)|\(G\)|grouped|group[eé]e?s?)'
    or v_concept ~* '(\s*-\s*\(G\)$|\(G\)$|\s*-\s*G$|\bgrouped\b|\bgroup[eé]e?s?\b)'
    or v_name ~* '^(?:DV_|D[A-Z]{2,4}[0-9]|DV[A-Z])'
    or v_name ~* 'DV'
    or v_name ~* '^[A-Z]{2,4}D[A-Z0-9]{2,}$'
    or v_note ~* '^(?:based on|derived from|calcul[eé]|selon|compos[eé])|see documentation on derived variables'
  ) then
    return 'derived';
  end if;

  return 'collected';
end;
$$;

-- Backward-compatible 4-parameter overload
create or replace function corpus_variable_role(
  p_name text,
  p_concept text default null,
  p_note text default null,
  p_survey_group text default null
) returns text
language sql
immutable
as $$
  select corpus_variable_role(p_name, p_concept, p_note, p_survey_group, null);
$$;

-- 2. Deploy 28 academic search aliases
insert into corpus_search_alias (query, expansion)
values
  ('unmet healthcare needs', 'unmet health care needs'),
  ('healthcare needs', 'health care needs'),
  ('self rated health', 'perceived health'),
  ('self-rated health', 'perceived health'),
  ('self reported health', 'perceived health'),
  ('general health status', 'perceived health'),
  ('poverty line', 'low income measure'),
  ('official poverty line', 'market basket measure'),
  ('working from home', 'telework'),
  ('precarious employment', 'temporary employment'),
  ('k10', 'distress scale'),
  ('k6', 'distress scale'),
  ('ces d', 'depression scale'),
  ('ces-d', 'depression scale'),
  ('phq 9', 'depression scale'),
  ('phq-9', 'depression scale'),
  ('functional limitation', 'activity limitation'),
  ('functional limitations', 'activity limitations'),
  ('core housing need', 'housing suitability'),
  ('unmet need', 'unmet health care needs'),
  ('food security', 'food insecurity'),
  ('vaping', 'electronic cigarette'),
  ('e-cigarette', 'electronic cigarette'),
  ('shift work', 'work schedule'),
  ('job satisfaction', 'satisfaction with job'),
  ('life satisfaction', 'satisfaction with life'),
  ('sense of belonging', 'belonging to community'),
  ('mental distress', 'psychological distress')
on conflict (query) do nothing;
