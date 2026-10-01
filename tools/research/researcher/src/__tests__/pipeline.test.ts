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
});
