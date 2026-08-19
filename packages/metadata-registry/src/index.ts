export * from './types.js';
export { buildRegistry, buildCatalog, type BuildRegistryOptions } from './extract.js';
export {
  buildSearchIndex,
  search,
  type SearchIndex,
  type SearchOptions,
} from './search.js';
export {
  SupabaseCorpusSource,
  toRegistryEntry as corpusRowToEntry,
  corpusCitation,
  CORPUS_LICENSE,
  CORPUS_ATTRIBUTION,
  type CorpusMeta,
  type CorpusCode,
  type CorpusSearchRow,
  type CorpusSearchOptions,
  type CorpusSearchResult,
  type CorpusSourceConfig,
  type CorpusStats,
  type CorpusSurvey,
  type CorpusFilters,
} from './corpus.js';
