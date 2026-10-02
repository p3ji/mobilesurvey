-- ==============================================================================
-- Migration Patch: 2026-10-02 LISA Marital & Education Concept Truncation Repair
--
-- Description:
-- Repairs legacy SAS codebook $70-character column truncations in LISA
-- (Longitudinal and International Study of Adults) across Waves 3 & 4.
-- Updates both `concept` and `search_text`, triggering automatic FTS index refresh.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Marital Status & Relationship History (FPM Series)
-- ------------------------------------------------------------------------------

-- FPM1QSPD / FPM2QSPD
UPDATE corpus_variable
   SET search_text = replace(search_text, concept, regexp_replace(concept, ', 2nd most r$', ', 2nd most recent relationship in reference period')),
       concept = regexp_replace(concept, ', 2nd most r$', ', 2nd most recent relationship in reference period')
 WHERE concept LIKE '%, 2nd most r';

UPDATE corpus_variable
   SET search_text = replace(search_text, concept, regexp_replace(concept, ', 3rd most r$', ', 3rd most recent relationship in reference period')),
       concept = regexp_replace(concept, ', 3rd most r$', ', 3rd most recent relationship in reference period')
 WHERE concept LIKE '%, 3rd most r';

-- FPM1DSPD / FPM2DSPD (Separation date)
UPDATE corpus_variable
   SET search_text = replace(search_text, concept, regexp_replace(concept, ' in refer$', ' in reference period')),
       concept = regexp_replace(concept, ' in refer$', ' in reference period')
 WHERE concept LIKE '% in refer';

-- FPM1QEND / FPM2QEND (How marriage ended)
UPDATE corpus_variable
   SET search_text = replace(search_text, concept, regexp_replace(concept, ' in re$', ' in reference period')),
       concept = regexp_replace(concept, ' in re$', ' in reference period')
 WHERE concept LIKE '% in re';

-- FPM1DMST / FPM2DMST (Marriage start date)
UPDATE corpus_variable
   SET search_text = replace(search_text, concept, regexp_replace(concept, ' in r$', ' in reference period')),
       concept = regexp_replace(concept, ' in r$', ' in reference period')
 WHERE concept LIKE '% in r';

-- FPMCDCCS (Current common-law union date)
UPDATE corpus_variable
   SET search_text = replace(search_text, concept, regexp_replace(concept, 'with co$', 'with common-law partner')),
       concept = regexp_replace(concept, 'with co$', 'with common-law partner')
 WHERE concept LIKE '%with co';

-- FPMCMNUM (Number of other times legally married)
UPDATE corpus_variable
   SET search_text = replace(search_text, concept, regexp_replace(concept, ' in reference per$', ' in reference period')),
       concept = regexp_replace(concept, ' in reference per$', ' in reference period')
 WHERE concept LIKE '% in reference per';

-- FPM1DEND, FPM1DMCS, FPM1TYPE, FPM2DEND, FPM2DMCS, FPM2TYPE, FPMCCNUM (Ending in "relationship in")
UPDATE corpus_variable
   SET search_text = replace(search_text, concept, concept || ' reference period'),
       concept = concept || ' reference period'
 WHERE concept LIKE '%relationship in';

-- ------------------------------------------------------------------------------
-- 2. School Attendance (EDSAD Series)
-- ------------------------------------------------------------------------------

-- EDSAD20B
UPDATE corpus_variable
   SET search_text = replace(search_text, concept, 'School attendance: Second highest level studied for during reference period'),
       concept = 'School attendance: Second highest level studied for during reference period'
 WHERE name = 'EDSAD20B' 
   AND (concept LIKE 'School attendance: Second highest level studied for during reference p%' 
        OR concept LIKE 'School attendance: Second highest level studied for during ref. period%');

-- EDSAD20C
UPDATE corpus_variable
   SET search_text = replace(search_text, concept, 'School attendance: Third highest level studied for during reference period'),
       concept = 'School attendance: Third highest level studied for during reference period'
 WHERE name = 'EDSAD20C'
   AND (concept LIKE 'School attendance: Third highest level studied for during reference pe%' 
        OR concept LIKE 'School attendance: Third highest level studied for during ref. period%');

-- ------------------------------------------------------------------------------
-- 3. Labour Market Training Payment (LMT Series)
-- ------------------------------------------------------------------------------

UPDATE corpus_variable
   SET search_text = replace(search_text, concept, 'Job-related, non-employer sponsored training: Who paid - My own business'),
       concept = 'Job-related, non-employer sponsored training: Who paid - My own business'
 WHERE name = 'LMTNQ80B' AND concept = 'Job-related, non-employer sponsored training: Who paid - My own busine';

UPDATE corpus_variable
   SET search_text = replace(search_text, concept, 'Job-related, non-employer sponsored training: Who paid - Myself or my family'),
       concept = 'Job-related, non-employer sponsored training: Who paid - Myself or my family'
 WHERE name = 'LMTNQ80C' AND concept = 'Job-related, non-employer sponsored training: Who paid - Myself or my';

UPDATE corpus_variable
   SET search_text = replace(search_text, concept, 'Job-related, non-employer sponsored training: Who paid - Myself but reimbursed by employer'),
       concept = 'Job-related, non-employer sponsored training: Who paid - Myself but reimbursed by employer'
 WHERE name = 'LMTNQ80D' AND concept = 'Job-related, non-employer sponsored training: Who paid - Myself but re';

UPDATE corpus_variable
   SET search_text = replace(search_text, concept, 'Job-related, non-employer sponsored training: Who paid - A professional association'),
       concept = 'Job-related, non-employer sponsored training: Who paid - A professional association'
 WHERE name = 'LMTNQ80F' AND concept = 'Job-related, non-employer sponsored training: Who paid - A professiona';

-- ------------------------------------------------------------------------------
-- 4. Postsecondary Financial Planning (CHFP Series)
-- ------------------------------------------------------------------------------

-- Saving Methods
UPDATE corpus_variable
   SET search_text = replace(search_text, concept, 'Postsecondary financial planning: Saving methods, Registered Education Savings Plans (RESPs)'),
       concept = 'Postsecondary financial planning: Saving methods, Registered Education Savings Plans (RESPs)'
 WHERE name = 'CHFPQ20A' AND concept LIKE 'Postsecondary financial planning: Saving methods, Registered Education%';

UPDATE corpus_variable
   SET search_text = replace(search_text, concept, 'Postsecondary financial planning: Saving methods, Tax-Free Savings Accounts (TFSAs)'),
       concept = 'Postsecondary financial planning: Saving methods, Tax-Free Savings Accounts (TFSAs)'
 WHERE name = 'CHFPQ20B' AND concept LIKE 'Postsecondary financial planning: Saving methods, Tax-Free Savings Acc%';

UPDATE corpus_variable
   SET search_text = replace(search_text, concept, 'Postsecondary financial planning: Saving methods, Regular savings accounts'),
       concept = 'Postsecondary financial planning: Saving methods, Regular savings accounts'
 WHERE name = 'CHFPQ20C' AND concept LIKE 'Postsecondary financial planning: Saving methods, Regular savings acco%';

UPDATE corpus_variable
   SET search_text = replace(search_text, concept, 'Postsecondary financial planning: Saving methods, Investments not in a registered account'),
       concept = 'Postsecondary financial planning: Saving methods, Investments not in a registered account'
 WHERE name = 'CHFPQ20D' AND concept LIKE 'Postsecondary financial planning: Saving methods, Investments not in a%';

UPDATE corpus_variable
   SET search_text = replace(search_text, concept, 'Postsecondary financial planning: Saving methods, Other types of savings methods'),
       concept = 'Postsecondary financial planning: Saving methods, Other types of savings methods'
 WHERE name = 'CHFPQ20E' AND concept LIKE 'Postsecondary financial planning: Saving methods, Other types of savin%';

-- Reasons for No Savings
UPDATE corpus_variable
   SET search_text = replace(search_text, concept, 'Postsecondary financial planning: No savings, Parents will pay or help when the time comes'),
       concept = 'Postsecondary financial planning: No savings, Parents will pay or help when the time comes'
 WHERE name = 'CHFPQ15A' AND concept LIKE 'Postsecondary financial planning: No savings, Parents will pay or help%';

UPDATE corpus_variable
   SET search_text = replace(search_text, concept, 'Postsecondary financial planning: No savings, Child will pay and/or take out loans'),
       concept = 'Postsecondary financial planning: No savings, Child will pay and/or take out loans'
 WHERE name = 'CHFPQ15B' AND concept LIKE 'Postsecondary financial planning: No savings, Child will pay and/or ta%';

UPDATE corpus_variable
   SET search_text = replace(search_text, concept, 'Postsecondary financial planning: No savings, Child will use savings and/or income'),
       concept = 'Postsecondary financial planning: No savings, Child will use savings and/or income'
 WHERE name = 'CHFPQ15C' AND concept LIKE 'Postsecondary financial planning: No savings, Child will use savings a%';

UPDATE corpus_variable
   SET search_text = replace(search_text, concept, 'Postsecondary financial planning: No savings, Do not have to pay for postsecondary education'),
       concept = 'Postsecondary financial planning: No savings, Do not have to pay for postsecondary education'
 WHERE name = 'CHFPQ15D' AND concept LIKE 'Postsecondary financial planning: No savings, Do not have to pay for p%';

UPDATE corpus_variable
   SET search_text = replace(search_text, concept, 'Postsecondary financial planning: No savings, Parents do not feel they have an obligation to pay'),
       concept = 'Postsecondary financial planning: No savings, Parents do not feel they have an obligation to pay'
 WHERE name = 'CHFPQ15E' AND concept LIKE 'Postsecondary financial planning: No savings, Parents do not feel they%';

UPDATE corpus_variable
   SET search_text = replace(search_text, concept, 'Postsecondary financial planning: No savings, Parents don’t think postsecondary education is important'),
       concept = 'Postsecondary financial planning: No savings, Parents don’t think postsecondary education is important'
 WHERE name = 'CHFPQ15F' AND concept LIKE 'Postsecondary financial planning: No savings, Parents don’t think post%';

UPDATE corpus_variable
   SET search_text = replace(search_text, concept, 'Postsecondary financial planning: No savings, Parents don’t have sufficient money'),
       concept = 'Postsecondary financial planning: No savings, Parents don’t have sufficient money'
 WHERE name = 'CHFPQ15G' AND concept LIKE 'Postsecondary financial planning: No savings, Parents don’t have suffi%';

UPDATE corpus_variable
   SET search_text = replace(search_text, concept, 'Postsecondary financial planning: No savings, Parents have other priorities'),
       concept = 'Postsecondary financial planning: No savings, Parents have other priorities'
 WHERE name = 'CHFPQ15H' AND concept LIKE 'Postsecondary financial planning: No savings, Parents have other prior%';

-- ------------------------------------------------------------------------------
-- 5. Student Disability Accommodation (PTSTUDIS)
-- ------------------------------------------------------------------------------

UPDATE corpus_variable
   SET search_text = replace(search_text, concept, 'Part-Time Student is Considered Full-Time Due to the Individual’s Disability'),
       concept = 'Part-Time Student is Considered Full-Time Due to the Individual’s Disability'
 WHERE name = 'PTSTUDIS' AND concept LIKE 'Part-Time Student is Considered Full-Time Due to the Individual’s Disa%';

COMMIT;
