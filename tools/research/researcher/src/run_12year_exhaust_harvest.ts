import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ResearchQueue } from './queue.js';
import { harvestOpenAlexAll } from './adapters/openalex.js';
import { assembleCandidates } from './adapters/discovery.js';
import { publicPreview } from './public-preview.js';
import { type CandidateWork } from './model.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const dbPath = path.join(ROOT, 'out', 'researcher.db');
const previewFile = path.resolve(ROOT, '../../../platform/hub/src/researcherPilot.json');

export const CANONICAL_HARVEST_QUERIES = [
  { program: 'CCHS', query: '"Canadian Community Health Survey"' },
  { program: 'CCHS', query: '"Enquête sur la santé dans les collectivités canadiennes"' },
  { program: 'CSD', query: '"Canadian Survey on Disability"' },
  { program: 'CSD', query: '"Enquête canadienne sur l\'incapacité"' },
  { program: 'CIS', query: '"Canadian Income Survey"' },
  { program: 'CIS', query: '"Enquête canadienne sur le revenu"' },
  { program: 'CHMS', query: '"Canadian Health Measures Survey"' },
  { program: 'CHMS', query: '"Enquête canadienne sur les mesures de la santé"' },
  { program: 'SHS', query: '"Survey of Household Spending"' },
  { program: 'SHS', query: '"Enquête sur les dépenses des ménages"' },
  { program: 'CIUS', query: '"Canadian Internet Use Survey"' },
  { program: 'CIUS', query: '"Enquête canadienne sur l\'utilisation d\'Internet"' },
  { program: 'GSS', query: '"General Social Survey" "Statistics Canada"' },
  { program: 'GSS', query: '"Canadian General Social Survey"' },
  { program: 'GSS', query: '"Enquête sociale générale" "Statistique Canada"' },
  { program: 'LFS', query: '"Labour Force Survey" "Statistics Canada"' },
  { program: 'LFS', query: '"Canadian Labour Force Survey"' },
  { program: 'LFS', query: '"Enquête sur la population active" "Statistique Canada"' },
  { program: 'APS', query: '"Aboriginal Peoples Survey"' },
  { program: 'APS', query: '"Enquête auprès des peuples autochtones"' },
  { program: 'CHS', query: '"Canadian Housing Survey"' },
  { program: 'CHS', query: '"Enquête canadienne sur le logement"' },
  { program: 'SFS', query: '"Survey of Financial Security"' },
  { program: 'SFS', query: '"Enquête sur la sécurité financière"' },
  { program: 'LSIC', query: '"Longitudinal Survey of Immigrants to Canada"' },
  { program: 'LSIC', query: '"Enquête longitudinale auprès des immigrants du Canada"' },
  { program: 'LISA', query: '"Longitudinal and International Study of Adults"' },
  { program: 'LISA', query: '"Étude longitudinale et internationale des adultes"' },
  { program: 'CHSCY', query: '"Canadian Health Survey on Children and Youth"' },
  { program: 'CHSCY', query: '"Enquête canadienne sur la santé des enfants et des jeunes"' },
  { program: 'EICS', query: '"Employment Insurance Coverage Survey"' },
  { program: 'EICS', query: '"Enquête sur la couverture de l\'assurance-emploi"' },
  { program: 'NGS', query: '"National Graduates Survey"' },
  { program: 'NGS', query: '"Enquête auprès des diplômés"' },
  { program: 'CSS', query: '"Canadian Social Survey"' },
  { program: 'CSS', query: '"Enquête sociale canadienne"' },
  { program: 'CPSS', query: '"Canadian Perspectives Survey Series"' },
  { program: 'CPSS', query: '"Série d’enquêtes sur les perspectives canadiennes"' },
  { program: 'CSCSC', query: '"Canadian Survey of Cyber Security and Cybercrime"' },
  { program: 'CSCSC', query: '"Enquête canadienne sur la cybersécurité et le cybercrime"' },
  { program: 'SDTIU', query: '"Survey of Digital Technology and Internet Use"' },
  { program: 'SDTIU', query: '"Enquête sur les technologies numériques et l\'utilisation d\'Internet"' },
  { program: 'SFGSME', query: '"Survey on Financing and Growth of Small and Medium Enterprises"' },
  { program: 'SFGSME', query: '"Enquête sur le financement et la croissance des petites et moyennes entreprises"' },
  { program: 'SOLMP', query: '"Survey on the Official Language Minority Population"' },
  { program: 'SOLMP', query: '"Enquête sur la population de langue officielle en situation minoritaire"' },
  { program: 'CTADS', query: '"Canadian Tobacco, Alcohol and Drugs Survey"' },
  { program: 'CTADS', query: '"Enquête canadienne sur le tabac, l’alcool et les drogues"' },
  { program: 'CTNS', query: '"Canadian Tobacco and Nicotine Survey"' },
  { program: 'CTNS', query: '"Enquête canadienne sur le tabac et la nicotine"' },
  { program: 'HES', query: '"Households and the Environment Survey"' },
  { program: 'HES', query: '"Enquête sur les ménages et l’environnement"' },
  { program: 'PIAAC', query: '"Programme for the International Assessment of Adult Competencies" "Canada"' },
  { program: 'CAFHS', query: '"Canadian Armed Forces Health Survey"' },
  { program: 'CAFVMHS', query: '"Canadian Armed Forces Members and Veterans Mental Health Follow-up Survey"' },
  { program: 'CNICS', query: '"Childhood National Immunization Coverage Survey"' },
  { program: 'CSIT', query: '"Canadian Survey on Interprovincial Trade"' },
  { program: 'EWHS', query: '"Survey on Working from Home and Working Conditions"' },
  { program: 'PSIS', query: '"Postsecondary Student Information System" "Statistics Canada"' },
  { program: 'RAIS', query: '"Registered Apprenticeship Information System" "Statistics Canada"' },
  { program: 'IMDB', query: '"Longitudinal Immigration Database"' },
  { program: 'NHS', query: '"National Household Survey" "Statistics Canada"' },
  { program: 'PSES', query: '"Public Service Employee Survey" "Canada"' },
  { program: 'CLPS', query: '"Canadian Legal Problems Survey"' },
  { program: 'CVCS', query: '"Canadian Survey on Victimization and Community Safety"' },
  { program: 'SCMH', query: '"Survey on COVID-19 and Mental Health"' },
  { program: 'CADS', query: '"Canadian Alcohol and Drugs Survey"' },
  { program: 'SMHSE', query: '"Survey on Mental Health and Stressful Events"' },
];

export async function run12YearExhaustHarvest() {
  const q = new ResearchQueue(dbPath);
  console.log(`\n======================================================`);
  console.log(`[Work Stream 2] Starting 12-Year OpenAlex Exhaust Drain`);
  console.log(`Horizon: 2015–2026 across ${CANONICAL_HARVEST_QUERIES.length} bilingual queries`);
  console.log(`======================================================\n`);

  const allCandidates: CandidateWork[] = [];
  // Drain 12 years in three 4-year epochs to ensure balanced cursor depth and prevent timeouts
  const yearEpochs = [
    '2015|2016|2017|2018',
    '2019|2020|2021|2022',
    '2023|2024|2025|2026',
  ];

  for (let e = 0; e < yearEpochs.length; e++) {
    const epochYears = yearEpochs[e]!;
    console.log(`\n--- Epoch ${e + 1}/3: Years ${epochYears} ---`);

    for (let i = 0; i < CANONICAL_HARVEST_QUERIES.length; i++) {
      const item = CANONICAL_HARVEST_QUERIES[i]!;
      console.log(`[Epoch ${e + 1}] (${i + 1}/${CANONICAL_HARVEST_QUERIES.length}) Harvesting ${item.program}: ${item.query}...`);
      try {
        const res = await harvestOpenAlexAll(item.query, {
          filter: `publication_year:${epochYears}`,
          maxRecords: 1500,
          queue: q,
          onProgress: (fetched, total) => {
            process.stdout.write(`   fetched ${fetched}/${total}\r`);
          },
        });
        console.log(`   retrieved: ${res.works.length} works (total index count: ${res.totalCount})`);
        for (const w of res.works) {
          w.suggestedPrograms = [...new Set([...(w.suggestedPrograms ?? []), item.program])];
          allCandidates.push(w);
        }
      } catch (err: any) {
        console.error(`   Warning: Query failed for ${item.program}: ${err.message || err}`);
      }
      await new Promise(r => setTimeout(r, 300));
    }
  }

  console.log(`\n[Harvest Complete] Total raw candidate works gathered: ${allCandidates.length}`);

  // Assemble and deduplicate candidates
  const sources = assembleCandidates(allCandidates);
  console.log(`[Deduplication] Assembled ${sources.length} unique source works.`);

  // Seed into database
  let seeded = 0;
  for (const s of sources) {
    seeded += q.seed(s, 'deterministic');
  }
  console.log(`[Queue Seeding] Seeded ${seeded} extraction jobs into researcher.db.`);

  // Reprocess deterministic extraction
  console.log('[Deterministic Extraction] Running deterministic extraction with Canadian grounding & cycle validation...');
  const res = q.reprocessDeterministic();
  console.log(`[Deterministic Extraction Complete] ${res.reprocessed} jobs, ${res.claimsUpdated} claims updated.`);

  // Audit
  const audit = q.audit();
  console.log('[Queue Audit - Zero Hallucination Check]:', JSON.stringify(audit));

  // Export reviewed
  const reviewed = q.exportReviewed();
  console.log(`[Catalogue Export] Total reviewed works across all periods: ${reviewed.length}`);

  // Filter with 2015 cutoff for public preview
  const publicWorks = publicPreview(reviewed, 2015);
  console.log(`[Catalogue Export] Active 2015+ works for site: ${publicWorks.length}`);

  // Write out snapshot
  fs.writeFileSync(previewFile, JSON.stringify(publicWorks, null, 2) + '\n');
  console.log(`[Snapshot Written] Updated ${previewFile} with ${publicWorks.length} public works.`);

  q.close();
  console.log(`\n✓ Work Stream 2: 12-Year Exhaust Harvest Successfully Finished.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run12YearExhaustHarvest().catch(err => {
    console.error('Fatal error in 12-year harvest:', err);
    process.exit(1);
  });
}
