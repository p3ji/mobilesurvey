import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ResearchQueue } from './queue.js';
import { extract } from './hermes.js';
import { validateSource, type SourceWork } from './model.js';
import { publicPreview } from './public-preview.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dbPath=process.env.RESEARCHER_DB ?? path.join(ROOT,'out','researcher.db');
const model=process.env.LOCAL_LLM_MODEL ?? 'qwen3.8-27b';
const endpoint=process.env.LOCAL_LLM_URL ?? 'http://127.0.0.1:1234/v1';
const [command,...args]=process.argv.slice(2);

async function main() {
  const q=new ResearchQueue(dbPath);
  try {
    if (command==='seed') {
      if (!args[0]) throw new Error('Usage: researcher seed <sources.jsonl>');
      const lines=createInterface({input:createReadStream(args[0],{encoding:'utf8'}),crlfDelay:Infinity});
      let works=0,jobs=0;
      for await (const line of lines) {
        if (!line.trim()) continue;
        const source=validateSource(JSON.parse(line));
        jobs+=q.seed(source,model); works++;
      }
      console.log(JSON.stringify({worksRead:works,jobsAdded:jobs}));
    } else if (command==='run') {
      const limit=args[0] ? Number(args[0]) : 25;
      if (!Number.isInteger(limit) || limit<1 || limit>10000) throw new Error('Run limit must be 1..10000');
      for (let n=0;n<limit;n++) {
        const job=q.lease(); if (!job) break;
        try {
          const source=JSON.parse(job.source_json) as SourceWork;
          const result=await extract(source,job.chunk,endpoint,model);
          q.complete(job,result.value,result.issues);
          console.log(JSON.stringify({job:job.id,status:'completed',claims:result.value.claims.length,issues:result.issues}));
        } catch(error) {
          const message=String(error);
          const retryable=!/Local model HTTP 4\d\d/.test(message);
          q.fail(job.id,message,retryable);
          console.error(JSON.stringify({job:job.id,status:retryable?'retry':'failed',error:message}));
        }
      }
    } else if (command==='status') console.log(JSON.stringify(q.stats(),null,2));
    else if (command==='audit') console.log(JSON.stringify(q.audit()));
    else if (command==='reset-failed') console.log(JSON.stringify({jobsReset:q.resetFailed()}));
    else if (command==='review') console.log(JSON.stringify(q.reviewRows(args[0] ? Number(args[0]) : 50),null,2));
    else if (command==='approve' || command==='reject') {
      if (!args[0]) throw new Error(`Usage: researcher ${command} <claim-id>`);
      q.review(args[0],command==='approve'?'approved':'rejected');
      console.log(`${command}d ${args[0]}`);
    } else if (command==='export') {
      if (!args[0]) throw new Error('Usage: researcher export <reviewed.jsonl>');
      const records=q.exportReviewed();
      writeFileSync(args[0],records.map(r=>JSON.stringify(r)).join('\n')+(records.length?'\n':''),{flag:'w'});
      console.log(JSON.stringify({reviewedWorks:records.length,path:args[0]}));
    } else if (command==='preview') {
      if (!args[0]) throw new Error('Usage: researcher preview <public.json>');
      const records=publicPreview(q.exportReviewed());
      writeFileSync(args[0],JSON.stringify(records,null,2)+'\n',{flag:'w'});
      console.log(JSON.stringify({publicPilotWorks:records.length,path:args[0]}));
    } else throw new Error('Commands: seed <jsonl> | run [limit] | status | audit | reset-failed | review [limit] | approve <claim-id> | reject <claim-id> | export <jsonl> | preview <json>');
  } finally { q.close(); }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
