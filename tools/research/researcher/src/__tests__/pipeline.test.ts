import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ResearchQueue } from '../queue.js';
import { localEndpoint } from '../hermes.js';
import { publicPreview } from '../public-preview.js';
import { canonicalDoi, chunks, validateExtraction, type SourceWork } from '../model.js';

const dirs:string[]=[];
afterEach(()=>{for(const dir of dirs.splice(0)) rmSync(dir,{recursive:true,force:true});});

const work:SourceWork={
  title:'Pilot article',doi:'https://doi.org/10.1234/ABC',url:'https://example.org/article',source:'pilot',
  passage:'We analyzed the Canadian Internet Use Survey (CIUS) 2022 data.',passageLocation:'Methods, p. 3',
  surveyCandidates:[{program:'CIUS',aliases:['Canadian Internet Use Survey','CIUS']}],
};
const extraction={claims:[{surveyText:'Canadian Internet Use Survey',program:'CIUS',role:'analyzed' as const,
  cycleText:'2022',precision:'exact_cycles' as const,exactCycles:['2022'],
  quote:work.passage,location:'Methods, p. 3'}],primaryTheme:'digital society',additionalThemes:[],
  themeRationale:'Study of internet use',variables:[]};

describe('Researcher pipeline',()=>{
  it('normalizes DOI and chunks within bounds',()=>{
    expect(canonicalDoi(work.doi)).toBe('10.1234/abc');
    expect(chunks('abcdefghij',6,2)).toEqual(['abcdef','efghij']);
    expect(localEndpoint('http://127.0.0.1:1234/v1')).toBe('http://127.0.0.1:1234/v1');
    expect(()=>localEndpoint('https://example.org/v1')).toThrow('loopback');
  });
  it('rejects unsupported exact cycles and quotes',()=>{
    expect(validateExtraction(extraction,work.passage,work.surveyCandidates).issues).toEqual([]);
    expect(validateExtraction({...extraction,claims:[{...extraction.claims[0],exactCycles:['2020']}]},work.passage,work.surveyCandidates).issues).toContain('claim 0: unsupported exact cycle');
  });
  it('keeps approval and export review gated',()=>{
    const dir=mkdtempSync(path.join(tmpdir(),'researcher-'));dirs.push(dir);
    const q=new ResearchQueue(path.join(dir,'queue.db'));
    try {
      expect(q.seed(work,'test-model')).toBe(1);
      expect(q.seed(work,'test-model')).toBe(0);
      const job=q.lease()!;
      q.complete(job,extraction,[]);
      expect(q.exportReviewed()).toEqual([]);
      const claim=q.reviewRows()[0] as {id:string};
      q.review(claim.id,'approved');
      const exported=q.exportReviewed() as Array<{id:string;claims:unknown[]}>;
      expect(exported).toHaveLength(1);
      expect(exported[0]!.claims).toHaveLength(1);
      expect(exported[0]!.id).toBe('doi:10.1234/abc');
      expect(JSON.stringify(publicPreview(exported))).not.toContain(work.passage);
    } finally {q.close();}
  });
  it('blocks only the claim whose evidence is unsupported',()=>{
    const dir=mkdtempSync(path.join(tmpdir(),'researcher-'));dirs.push(dir);
    const q=new ResearchQueue(path.join(dir,'queue.db'));
    try {
      q.seed(work,'test-model');
      const job=q.lease()!;
      const bad={...extraction.claims[0],quote:'fabricated quote'};
      const value={...extraction,claims:[bad,extraction.claims[0]]};
      const checked=validateExtraction(value,job.chunk,work.surveyCandidates);
      q.complete(job,checked.value,checked.issues);
      q.audit();
      const rows=q.reviewRows() as Array<{id:string;kind:string;issues:string}>;
      const badRow=rows.find(row=>row.kind==='survey' && row.issues!=='[]')!;
      const goodRow=rows.find(row=>row.kind==='survey' && row.issues==='[]')!;
      expect(()=>q.review(badRow.id,'approved')).toThrow('evidence issues');
      q.review(goodRow.id,'approved');
      expect(q.exportReviewed()).toHaveLength(1);
    } finally {q.close();}
  });
  it('shows the most precise reviewed claim when a program-only claim is later refined',()=>{
    const reviewed={id:'doi:10.1234/abc',title:'Pilot',doi:'10.1234/abc',url:'https://example.org/a',year:2020,workType:'article',sources:[{source:'publisher',url:'https://example.org/a'}],themes:[],
      claims:[
        {...extraction.claims[0],precision:'program_only',exactCycles:[],cycleText:'',quote:'earlier passage'},
        {...extraction.claims[0],precision:'range',exactCycles:[],cycleText:'2018 to 2020'},
      ]};
    expect(publicPreview([reviewed])[0]!.uses).toHaveLength(1);
    expect(publicPreview([reviewed])[0]!.uses[0]!.precision).toBe('range');
  });
  it('excludes Statistics Canada publications from the public pilot',()=>{
    const reviewed={id:'official',title:'Official analysis',doi:null,url:'https://www150.statcan.gc.ca/n1/en/pub/official',year:2022,workType:'report',
      sources:[{source:'Crossref',url:'https://api.crossref.org/works/official'}],themes:[],claims:extraction.claims};
    expect(publicPreview([reviewed])).toEqual([]);
    expect(publicPreview([{...reviewed,id:'external',url:'https://example.org/external'}])).toHaveLength(1);
    expect(publicPreview([{...reviewed,id:'official-mirror',url:'https://example.org/official',issuingOrganization:'Statistics Canada'}])).toEqual([]);
    expect(publicPreview([{...reviewed,id:'indexed-external',url:'https://example.org/external',sources:[{source:'Statistics Canada',url:'https://statcan.gc.ca/index'}],issuingOrganization:'University'}])).toHaveLength(1);
  });
  it('disambiguates generic survey names and rejects foreign statistical agencies', async () => {
    const { extractDeterministic } = await import('../deterministic.js');
    const lfsCandidates = [{ program: 'LFS', aliases: ['Labour Force Survey', 'LFS', 'Enquête sur la population active', 'EPA'] }];
    const cisCandidates = [{ program: 'CIS', aliases: ['Canadian Income Survey', 'CIS', 'Enquête canadienne sur le revenu', 'ECR'] }];

    // Australian Bureau of Statistics LFS
    const ausWork: SourceWork = {
      title: 'Bayesian Seasonal Adjustment for Survey Time Series',
      url: 'https://arxiv.org/abs/2607.17226',
      source: 'arxiv',
      passage: 'Applied to 120 months of Australian Bureau of Statistics Labour Force Survey data, once sampling variance is modelled...',
      passageLocation: 'Abstract',
      surveyCandidates: lfsCandidates,
    };
    expect(extractDeterministic(ausWork, ausWork.passage).value.claims).toHaveLength(0);

    // French INSEE Enquête sur la population active
    const frWork: SourceWork = {
      title: 'Le logement, facteur de sécurisation pour des classes moyennes fragilisées ?',
      url: 'https://example.org/fr',
      source: 'cairn',
      passage: 'À l’issue d’une vaste enquête sur la population active en France, cet article montre les décalages existant...',
      passageLocation: 'Abstract',
      surveyCandidates: lfsCandidates,
    };
    expect(extractDeterministic(frWork, frWork.passage).value.claims).toHaveLength(0);

    // UK Labour Force Survey
    const ukWork: SourceWork = {
      title: 'Male Joblessness and Job Search: Regional Perspectives in the UK, 1981–1993',
      url: 'https://example.org/uk',
      source: 'tandf',
      passage: 'Using United Kingdom Labour Force Survey data for the years 1981–93, this paper examines regional unemployment...',
      passageLocation: 'Abstract',
      surveyCandidates: lfsCandidates,
    };
    expect(extractDeterministic(ukWork, ukWork.passage).value.claims).toHaveLength(0);

    // Accented French word boundary (précisément should not match CIS)
    const accentWork: SourceWork = {
      title: 'Atlas sur les migrations internationales',
      url: 'https://example.org/atlas',
      source: 'openedition',
      passage: 'À notre grande surprise, nous avons pu identifier plus précisément une dizaine de cartes régionales...',
      passageLocation: 'Abstract',
      surveyCandidates: cisCandidates,
    };
    expect(extractDeterministic(accentWork, accentWork.passage).value.claims).toHaveLength(0);

    // Short acronym without survey/data context (EPA = environmental agency)
    const epaWork: SourceWork = {
      title: 'Air Quality Standards and Industrial Emissions',
      url: 'https://example.org/epa',
      source: 'journal',
      passage: 'The EPA issued new federal guidelines on industrial sulfur dioxide emissions yesterday in Ottawa, Canada.',
      passageLocation: 'Abstract',
      surveyCandidates: lfsCandidates,
    };
    expect(extractDeterministic(epaWork, epaWork.passage).value.claims).toHaveLength(0);

    // Legitimate Canadian Labour Force Survey
    const canLfsWork: SourceWork = {
      title: "Nova Scotia's Labour Market: Assessing Job Quality and Precarity",
      url: 'https://example.org/ns-labour',
      source: 'ccpa',
      passage: 'We analyze microdata from the 2024 Labour Force Survey conducted by Statistics Canada to construct an Employment Precarity Index.',
      passageLocation: 'Methodology, p. 4',
      surveyCandidates: lfsCandidates,
    };
    const canLfsResult = extractDeterministic(canLfsWork, canLfsWork.passage);
    expect(canLfsResult.value.claims).toHaveLength(1);
    expect(canLfsResult.value.claims[0]!.program).toBe('LFS');
    expect(canLfsResult.value.claims[0]!.exactCycles).toEqual(['2024']);
    expect(canLfsResult.issues).toEqual([]);
  });

  it('distinguishes background mentions from active analysis and prevents citation years from becoming cycles', async () => {
    const { extractDeterministic } = await import('../deterministic.js');
    const ciusCandidates = [{ program: 'CIUS', aliases: ['Canadian Internet Use Survey', 'CIUS'] }];

    // AJER paper flagged by user (doi:10.55016/ojs/ajer.v63i2.56354)
    const ajerWork: SourceWork = {
      title: 'Predicting Problematic Internet Use in A Sample of Canadian University Students',
      doi: '10.55016/ojs/ajer.v63i2.56354',
      url: 'https://doi.org/10.55016/ojs/ajer.v63i2.56354',
      source: 'OpenAlex',
      passage: 'The growth of Internet users in Canada has been phenomenal.The most recent Canadian Internet Use Survey revealed that 83% of Canadian households had access to the Internet at home in 2012, compared with 79% in 2010 (Statistics Canada, 2013).Doubtlessly, the Internet has become an increasingly important feature of the learning environment for students.Excessive use of the Internet, however, can pose various serious risks for the users.In fact, the negative consequences that can arise from excessive Internet usage have attracted increasing research attention.Studies have demonstrated that academic under-performance, failure to exercise and to engage in faceto-face social activities, negative affective states, sleep deprivation, decreased ability to concentrate, health problems, and family conflicts were the frequently reported consequences of excessive internet use (Gür, Yurt, Bulduk, & Atagöz, 2015;',
      passageLocation: 'Abstract',
      surveyCandidates: ciusCandidates,
    };
    const ajerResult = extractDeterministic(ajerWork, ajerWork.passage);
    expect(ajerResult.value.claims).toHaveLength(1);
    const ajerClaim = ajerResult.value.claims[0]!;
    expect(ajerClaim.program).toBe('CIUS');
    expect(ajerClaim.role).toBe('background_mention');
    expect(ajerClaim.quote).toBe(
      'The most recent Canadian Internet Use Survey revealed that 83% of Canadian households had access to the Internet at home in 2012, compared with 79% in 2010 (Statistics Canada, 2013).'
    );
    expect(ajerClaim.exactCycles).toEqual([]);
    expect(ajerClaim.precision).toBe('program_only');
    expect(ajerResult.issues).toEqual([]);

    // According to ... citation
    const accordingWork: SourceWork = {
      title: 'Using the Internet as a Health Intermediary: Providing Information and Services to Marginalized Sexual Communities',
      url: 'https://example.org/health-intermediary',
      source: 'springer',
      passage: 'According to the Canadian Internet Use Survey, 58 per cent of Canadians have used the internet to search for medical or health-related information (CIUS, 2005).',
      passageLocation: 'Introduction',
      surveyCandidates: ciusCandidates,
    };
    const accordingResult = extractDeterministic(accordingWork, accordingWork.passage);
    expect(accordingResult.value.claims).toHaveLength(1);
    expect(accordingResult.value.claims[0]!.role).toBe('background_mention');
    expect(accordingResult.value.claims[0]!.exactCycles).toEqual([]);

    // Genuine multi-cycle active analysis
    const analyzedWork: SourceWork = {
      title: 'Digital Divide: A Typology of Internet Users in Canada',
      url: 'https://example.org/typology',
      source: 'journal',
      passage: 'Data for this study are from the 2018 and 2020 cycles of the CIUS (Canadian Internet Use Survey). We model adoption patterns using logistic regression.',
      passageLocation: 'Data and Methods',
      surveyCandidates: ciusCandidates,
    };
    const analyzedResult = extractDeterministic(analyzedWork, analyzedWork.passage);
    expect(analyzedResult.value.claims).toHaveLength(1);
    expect(analyzedResult.value.claims[0]!.role).toBe('analyzed');
    expect(analyzedResult.value.claims[0]!.exactCycles).toEqual(['2018', '2020']);
  });

  it('rejects claims referencing non-existent survey cycles (e.g. CIUS 2015)', async () => {
    const { CANONICAL_SURVEYS, validateExtraction } = await import('../model.js');
    const { extractDeterministic } = await import('../deterministic.js');

    const ciusSpec = CANONICAL_SURVEYS.CIUS!;
    const passage = 'We examined microdata from the 2015 Canadian Internet Use Survey (CIUS) to study online activity.';

    // 1. In deterministic extraction: 2015 is filtered out because it is not an official CIUS cycle
    const work: SourceWork = {
      title: 'Study of Online Activity',
      url: 'https://example.org/test',
      source: 'test',
      passage,
      passageLocation: 'Methods',
      surveyCandidates: [{ program: 'CIUS', aliases: ciusSpec.aliases, validCycles: ciusSpec.validCycles }],
    };
    const result = extractDeterministic(work, passage);
    expect(result.value.claims).toHaveLength(1);
    // 2015 was not accepted as an exact cycle because CIUS 2015 never happened
    expect(result.value.claims[0]!.exactCycles).toEqual([]);
    expect(result.value.claims[0]!.precision).toBe('program_only');

    // 2. In validateExtraction: if any agent or model tries to claim 2015 as an exact cycle for CIUS, it is flagged as an invalid historical cycle
    const badExtraction = {
      claims: [{
        surveyText: 'Canadian Internet Use Survey',
        program: 'CIUS',
        role: 'analyzed' as const,
        cycleText: '2015',
        precision: 'exact_cycles' as const,
        exactCycles: ['2015'],
        quote: passage,
        location: 'Methods',
      }],
      primaryTheme: 'digital society',
      additionalThemes: [],
      themeRationale: 'Internet use',
      variables: [],
    };
    const checked = validateExtraction(badExtraction, passage, work.surveyCandidates);
    expect(checked.issues).toContain('claim 0: non-existent survey cycle(s) for CIUS: 2015');
  });
});
