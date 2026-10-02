-- ==============================================================================
-- Migration Patch: 2026-10-02 Corpus Concept Reconstruction & Epistemic Repair
--
-- Description:
-- Implements the two-tiered ground truth reconstruction hierarchy:
-- Tier 1: Restores unabbreviated concepts directly from official StatCan source
--         codebook notes (393 variables) and source question text in CSD/APS/CHSCY.
-- Updates both `concept` and `search_text`, triggering automatic FTS index refresh.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Official StatCan Data Dictionary Notes (Tier 1 Primary Source)
-- ------------------------------------------------------------------------------

DO $$
DECLARE
    r RECORD;
    v_full TEXT;
    v_clean TEXT;
BEGIN
    FOR r IN 
        SELECT record_id, name, concept, note, search_text
          FROM corpus_variable
         WHERE note LIKE '%The concept was abbreviated due to space restrictions. Full text is as follows:%'
    LOOP
        -- Extract the full text portion after the marker
        v_full := substring(r.note from 'The concept was abbreviated due to space restrictions\. Full text is as follows:\s*(.*)');
        
        IF v_full IS NOT NULL AND length(v_full) > 0 THEN
            -- Cut off response category notes, frequency count notices, and page footers
            v_clean := regexp_replace(v_full, '(\.|\s)*(Some of (the )?(original )?response categories|Without frequency counts|Page [0-9]+).*$', '', 'i');
            
            -- Fix known line-wrap artifact in demographic prefix
            v_clean := replace(v_clean, 'Demo-graphic', 'Demographic');
            
            -- Fix line-wrap hyphenation (e.g. "re- sponsibility" -> "responsibility")
            v_clean := regexp_replace(v_clean, '([a-zA-Z])-\s+([a-zA-Z])', '\1\2', 'g');
            
            -- Collapse multiple whitespaces
            v_clean := trim(regexp_replace(v_clean, '\s+', ' ', 'g'));
            
            -- Strip trailing punctuation (. , ; : -)
            v_clean := regexp_replace(v_clean, '[\.,;:\-]+$', '');
            
            -- Only update if the extracted concept is substantive, longer, and not an unexpanded URL
            IF length(v_clean) > length(r.concept) AND v_clean NOT LIKE 'http%' THEN
                UPDATE corpus_variable
                   SET search_text = replace(search_text, concept, v_clean),
                       concept = v_clean
                 WHERE record_id = r.record_id;
            END IF;
        END IF;
    END LOOP;
END $$;

-- ------------------------------------------------------------------------------
-- 2. CSD 2017 & 2022 Assistive Devices & Accessibility Barriers (Tier 1 Question Text)
-- ------------------------------------------------------------------------------

-- Aids cannot be adapted
UPDATE corpus_variable
   SET search_text = replace(search_text, concept, regexp_replace(concept, 'can’t be adapt$', 'can’t be adapted')),
       concept = regexp_replace(concept, 'can’t be adapt$', 'can’t be adapted')
 WHERE concept LIKE '%can’t be adapt';

-- Expected income less than current income
UPDATE corpus_variable
   SET search_text = replace(search_text, concept, replace(concept, 'less than curr', 'less than current income')),
       concept = replace(concept, 'less than curr', 'less than current income')
 WHERE concept LIKE '%less than curr';

-- ------------------------------------------------------------------------------
-- 3. APS / Indigenous Peoples Survey Traditional Activities (Tier 1 Question Text)
-- ------------------------------------------------------------------------------

UPDATE corpus_variable
   SET search_text = replace(search_text, concept, replace(concept, 'Share with commun.', 'Share with community')),
       concept = replace(concept, 'Share with commun.', 'Share with community')
 WHERE concept LIKE '%Share with commun.';

UPDATE corpus_variable
   SET search_text = replace(search_text, concept, replace(concept, 'Share with commun', 'Share with community')),
       concept = replace(concept, 'Share with commun', 'Share with community')
 WHERE concept LIKE '%Share with commun';

-- ------------------------------------------------------------------------------
-- 4. CHSCY Canadian Health Survey on Children and Youth (Tier 1 Question Text)
-- ------------------------------------------------------------------------------

UPDATE corpus_variable
   SET search_text = replace(search_text, concept, replace(concept, 'time spent-7 d', 'time spent-7 days')),
       concept = replace(concept, 'time spent-7 d', 'time spent-7 days')
 WHERE concept LIKE '%time spent-7 d';

COMMIT;
