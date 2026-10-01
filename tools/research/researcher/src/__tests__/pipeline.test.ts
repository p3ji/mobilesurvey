import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ResearchQueue } from '../queue.js';
import { localEndpoint } from '../hermes.js';
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
    } finally {q.close();}
  });
});
