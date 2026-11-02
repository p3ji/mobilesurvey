/**
 * StatCan Web Data Service (WDS) API Client Engine
 * Integrated with Gate 0 Quality Filtering, Remine Fact Token Generation,
 * Fuzzy Member Matching, Multi-Coordinate Slicing, and Smart Catalogue Ranking.
 */

import type {
  CubeMetadata,
  FactToken,
  ObservationRow,
  ProvenanceMetadata,
  StatCanCubeSummary,
} from '../types.js';
import { extractFactTokens, gateZeroFilter } from './fact-binder.js';
import { matchDimensionMembers, MemberMatch } from './fuzzy-matcher.js';

const STATCAN_WDS_BASE = 'https://www150.statcan.gc.ca/t1/wds/rest';
const CACHE_KEY_CUBES = 'statcan_cubes_list_lite_v1';

/**
 * Normalizes any coordinate string to StatCan WDS's mandatory 10-part format.
 * Validates that each position references a member ID that actually exists in that dimension.
 */
function normalizeToTenParts(coord: string, meta: CubeMetadata): string {
  const parts = coord.split('.').filter(Boolean);

  for (let i = 0; i < meta.dimensions.length; i++) {
    const dim = meta.dimensions[i];
    const memberId = Number(parts[i]);
    const isValid = dim && dim.members.some((m) => m.memberId === memberId);

    if (!dim || !isValid) {
      // Pick the first valid memberId in this dimension
      const firstMemberId = dim?.members[0]?.memberId ?? 1;
      parts[i] = String(firstMemberId);
    }
  }

  // StatCan WDS mandates exactly 10 positions, padded with 0
  while (parts.length < 10) {
    parts.push('0');
  }

  return parts.slice(0, 10).join('.');
}

export class StatCanWdsClient {
  private cubeCache: StatCanCubeSummary[] | null = null;
  private metadataCache = new Map<number, CubeMetadata>();

  /**
   * Search StatCan tables by keyword or product ID with relevance ranking.
   * Penalizes inactive tables and rewards active, recently released tables.
   */
  async search(query: string, limit = 10): Promise<StatCanCubeSummary[]> {
    const cubes = await this.getAllCubes();
    const cleanQuery = query.trim().toLowerCase();
    const queryTokens = cleanQuery.split(/\s+/).filter(Boolean);

    const matches: Array<{ score: number; cube: StatCanCubeSummary }> = [];

    for (const cube of cubes) {
      const pidStr = String(cube.productId);
      const titleLower = (cube.cubeTitleEn || '').toLowerCase();

      // Exact product ID match gets top priority
      if (pidStr === cleanQuery || cleanQuery.includes(pidStr)) {
        matches.push({ score: 100, cube });
        continue;
      }

      let matchedTokens = 0;
      for (const token of queryTokens) {
        if (titleLower.includes(token)) {
          matchedTokens++;
        }
      }

      if (matchedTokens > 0) {
        let score = (matchedTokens / queryTokens.length) * 10;

        // Prioritize exact phrase matches in title
        if (titleLower.includes(cleanQuery)) {
          score += 15;
        }

        // Penalize inactive or discontinued tables
        if (titleLower.includes('inactive') || titleLower.includes('discontinued')) {
          score -= 25;
        }

        // Reward recent releases (2024–2026) vs historical releases (< 2019)
        if (cube.releaseTime) {
          const yearMatch = cube.releaseTime.match(/^(\d{4})/);
          if (yearMatch && yearMatch[1]) {
            const year = parseInt(yearMatch[1], 10);
            if (year >= 2024) score += 10;
            else if (year < 2019) score -= 15;
          }
        }

        matches.push({ score, cube });
      }
    }

    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, limit).map((m) => m.cube);
  }

  /**
   * Introspect dimensions and codelist members without downloading observations.
   * Supports optional fuzzy search to discover members matching terms.
   */
  async inspectDimensions(
    productId: number,
    matchTerms?: string[]
  ): Promise<{ metadata: CubeMetadata; matches?: Record<string, MemberMatch[]> }> {
    let metadata: CubeMetadata;

    if (this.metadataCache.has(productId)) {
      metadata = this.metadataCache.get(productId)!;
    } else {
      const resp = await fetch(`${STATCAN_WDS_BASE}/getCubeMetadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([{ productId }]),
      });

      if (!resp.ok) {
        throw new Error(`StatCan WDS HTTP ${resp.status} for getCubeMetadata`);
      }

      const payload = (await resp.json()) as any[];
      const first = payload[0];
      if (!first || first.status !== 'SUCCESS') {
        throw new Error(`StatCan WDS error: ${JSON.stringify(first)}`);
      }

      const rawCube = first.object;
      metadata = {
        productId: rawCube.productId,
        cubeTitleEn: rawCube.cubeTitleEn,
        cubeTitleFr: rawCube.cubeTitleFr,
        frequencyCode: rawCube.frequencyCode,
        frequencyDescription: this.frequencyDescription(rawCube.frequencyCode),
        startReferencePeriod: rawCube.startReferencePeriod,
        endReferencePeriod: rawCube.endReferencePeriod,
        dimensions: (rawCube.dimension || []).map((d: any) => ({
          dimensionPositionId: d.dimensionPositionId,
          dimensionNameEn: d.dimensionNameEn,
          hasUom: d.hasUom,
          members: (d.member || []).map((m: any) => ({
            memberId: m.memberId,
            memberNameEn: m.memberNameEn,
            parentMemberId: m.parentMemberId,
          })),
        })),
      };

      this.metadataCache.set(productId, metadata);
    }

    const matches = matchTerms && matchTerms.length > 0 ? matchDimensionMembers(metadata, matchTerms) : undefined;

    return { metadata, matches };
  }

  /**
   * Fetch a slice (or multi-coordinate slices) of observations.
   * Passes data through Gate 0 filtering, scale-factor mapping, and fact token generation.
   */
  async fetchSlice(
    productId: number,
    coordinates: string | string[],
    latestN = 6
  ): Promise<{
    rows: ObservationRow[];
    title: string;
    metadata: CubeMetadata;
    provenance: ProvenanceMetadata;
    facts: FactToken[];
    caveats: string[];
  }> {
    const { metadata: meta } = await this.inspectDimensions(productId);
    const rawCoords = Array.isArray(coordinates) ? coordinates : [coordinates];
    const normalizedCoords = rawCoords.map((c) => normalizeToTenParts(c, meta));

    const requests = normalizedCoords.map((coord) => ({
      productId,
      coordinate: coord,
      latestN,
    }));

    const resp = await fetch(`${STATCAN_WDS_BASE}/getDataFromCubePidCoordAndLatestNPeriods`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requests),
    });

    if (!resp.ok) {
      throw new Error(`StatCan WDS HTTP ${resp.status} for getDataFromCubePidCoordAndLatestNPeriods`);
    }

    const payload = (await resp.json()) as any[];
    const allRows: ObservationRow[] = [];
    const allCaveats: string[] = [];
    const allVectorIds = new Set<number>();
    let detectedSeasonalStatus: 'Seasonally adjusted' | 'Unadjusted' | 'Unknown' = 'Unknown';

    for (let reqIdx = 0; reqIdx < payload.length; reqIdx++) {
      const item = payload[reqIdx];
      const activeCoord = normalizedCoords[reqIdx] || normalizedCoords[0] || '1.1.1.1.0.0.0.0.0.0';
      if (!item || item.status !== 'SUCCESS') {
        continue;
      }

      const rawDataPoints = item.object?.vectorDataPoint || [];
      const scaleFactorCode = rawDataPoints[0]?.scalarFactorCode ?? 0;

      // 1. Pass through Gate 0: Code Bouncer
      const { rows: filteredRows, caveats } = gateZeroFilter(rawDataPoints, scaleFactorCode);
      for (const c of caveats) {
        if (!allCaveats.includes(c)) allCaveats.push(c);
      }

      // 2. Decode dimension member labels from coordinate
      const coordParts = activeCoord.split('.').map(Number);
      const dimMemberLabels: Record<string, string> = {};

      for (let i = 0; i < coordParts.length && i < meta.dimensions.length; i++) {
        const dim = meta.dimensions[i];
        const memberId = coordParts[i];
        if (dim && memberId && memberId > 0) {
          const found = dim.members.find((m) => m.memberId === memberId);
          const memberName = found ? found.memberNameEn : String(memberId);
          const cleanDimKey = dim.dimensionNameEn.toLowerCase().replace(/[^a-z0-9]+/g, '_');
          dimMemberLabels[cleanDimKey] = memberName;

          if (memberName.toLowerCase().includes('seasonally adjusted')) {
            detectedSeasonalStatus = 'Seasonally adjusted';
          } else if (memberName.toLowerCase().includes('unadjusted')) {
            detectedSeasonalStatus = 'Unadjusted';
          }
        }
      }

      // Attach dimension labels and coordinate to each row
      for (const r of filteredRows) {
        if (r.vectorId) allVectorIds.add(r.vectorId);
        allRows.push({
          ...r,
          ...dimMemberLabels,
          coordinate: activeCoord,
        });
      }
    }

    let finalNormalizedCoords = normalizedCoords;

    // Automated Sparse Cross-Tab Fallback:
    // If all initial coordinate requests yielded 0 rows, probe adjacent populated slices
    if (allRows.length === 0 && normalizedCoords.length > 0) {
      const fallback = await this.probeFallbackSlice(productId, meta, normalizedCoords[0]!, latestN);
      if (fallback) {
        finalNormalizedCoords = [fallback.coord];
        const rawDataPoints = fallback.rawPoints;
        const scaleFactorCode = rawDataPoints[0]?.scalarFactorCode ?? 0;
        const { rows: filteredRows, caveats } = gateZeroFilter(rawDataPoints, scaleFactorCode);
        for (const c of caveats) {
          if (!allCaveats.includes(c)) allCaveats.push(c);
        }

        const coordParts = fallback.coord.split('.').map(Number);
        const dimMemberLabels: Record<string, string> = {};
        const memberNames: string[] = [];

        for (let i = 0; i < coordParts.length && i < meta.dimensions.length; i++) {
          const dim = meta.dimensions[i];
          const memberId = coordParts[i];
          if (dim && memberId && memberId > 0) {
            const found = dim.members.find((m) => m.memberId === memberId);
            const memberName = found ? found.memberNameEn : String(memberId);
            const cleanDimKey = dim.dimensionNameEn.toLowerCase().replace(/[^a-z0-9]+/g, '_');
            dimMemberLabels[cleanDimKey] = memberName;
            memberNames.push(`${dim.dimensionNameEn}: ${memberName}`);

            if (memberName.toLowerCase().includes('seasonally adjusted')) {
              detectedSeasonalStatus = 'Seasonally adjusted';
            } else if (memberName.toLowerCase().includes('unadjusted')) {
              detectedSeasonalStatus = 'Unadjusted';
            }
          }
        }

        for (const r of filteredRows) {
          if (r.vectorId) allVectorIds.add(r.vectorId);
          allRows.push({
            ...r,
            ...dimMemberLabels,
            coordinate: fallback.coord,
          });
        }

        allCaveats.push(
          `Primary slice had no published observations. Automatically navigated to populated cross-tab (${memberNames.slice(0, 2).join('; ')}).`
        );
      }
    }

    // 3. Extract Remine Fact Tokens
    const facts = extractFactTokens(allRows, {}, meta.cubeTitleEn);

    // 4. Construct complete academic provenance record
    const provenance: ProvenanceMetadata = {
      productId,
      title: meta.cubeTitleEn,
      coordinate: finalNormalizedCoords.join('; '),
      vectorIds: Array.from(allVectorIds),
      frequency: meta.frequencyDescription,
      seasonalStatus: detectedSeasonalStatus,
      tableUrl: `https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=${productId}01`,
      wdsApiUrl: `${STATCAN_WDS_BASE}/getDataFromCubePidCoordAndLatestNPeriods`,
      extractedAt: new Date().toISOString(),
      caveats: allCaveats,
    };

    return {
      rows: allRows,
      title: meta.cubeTitleEn,
      metadata: meta,
      provenance,
      facts,
      caveats: allCaveats,
    };
  }

  /**
   * Fetch and cache the complete list of available StatCan cubes (~7,000 tables).
   * Uses localStorage when available in browser to avoid repeated downloads.
   */
  private async getAllCubes(): Promise<StatCanCubeSummary[]> {
    if (this.cubeCache) {
      return this.cubeCache;
    }

    // Try browser localStorage cache
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const cachedStr = localStorage.getItem(CACHE_KEY_CUBES);
        if (cachedStr) {
          const parsed = JSON.parse(cachedStr);
          if (Array.isArray(parsed) && parsed.length > 1000) {
            this.cubeCache = parsed;
            return parsed;
          }
        }
      } catch {
        // Ignore localStorage read errors
      }
    }

    const resp = await fetch(`${STATCAN_WDS_BASE}/getAllCubesListLite`);
    if (!resp.ok) {
      throw new Error(`Failed to load StatCan cube list: HTTP ${resp.status}`);
    }

    const rawList = (await resp.json()) as any[];
    this.cubeCache = rawList.map((item: any) => ({
      productId: item.productId,
      cubeTitleEn: item.cubeTitleEn,
      cubeTitleFr: item.cubeTitleFr,
      releaseTime: item.releaseTime,
      subjectCode: item.subjectCode,
    }));

    // Cache in localStorage asynchronously
    if (typeof window !== 'undefined' && window.localStorage && this.cubeCache) {
      try {
        localStorage.setItem(CACHE_KEY_CUBES, JSON.stringify(this.cubeCache));
      } catch {
        // Ignore quota errors
      }
    }

    return this.cubeCache;
  }

  /**
   * Automated Sparse Cross-Tab Probe
   * When an initial coordinate returns zero published rows,
   * systematically probes adjacent dimension member combinations
   * to locate the nearest populated slice.
   */
  private async probeFallbackSlice(
    productId: number,
    meta: CubeMetadata,
    initialCoord: string,
    latestN: number
  ): Promise<{ coord: string; rawPoints: any[] } | null> {
    const parts = initialCoord.split('.');
    const candidates: string[] = [];

    // 1. Probe variations across individual dimensions
    for (let dimIdx = 0; dimIdx < meta.dimensions.length; dimIdx++) {
      const dim = meta.dimensions[dimIdx];
      if (!dim) continue;
      for (let mIdx = 0; mIdx < Math.min(dim.members.length, 5); mIdx++) {
        const member = dim.members[mIdx];
        if (member && String(member.memberId) !== parts[dimIdx]) {
          const copy = [...parts];
          copy[dimIdx] = String(member.memberId);
          candidates.push(normalizeToTenParts(copy.join('.'), meta));
        }
      }
    }

    // 2. Grid probe across dim 0 and dim 1 (common for geography x measure tables)
    if (meta.dimensions.length >= 2) {
      const d0 = meta.dimensions[0];
      const d1 = meta.dimensions[1];
      if (d0 && d1) {
        for (const d0m of d0.members.slice(0, 4)) {
          for (const d1m of d1.members.slice(0, 4)) {
            const copy = [...parts];
            copy[0] = String(d0m.memberId);
            copy[1] = String(d1m.memberId);
            candidates.push(normalizeToTenParts(copy.join('.'), meta));
          }
        }
      }
    }

    const uniqueCandidates = Array.from(new Set(candidates)).slice(0, 16);
    if (uniqueCandidates.length === 0) return null;

    const reqs = uniqueCandidates.map((coord) => ({
      productId,
      coordinate: coord,
      latestN,
    }));

    try {
      const resp = await fetch(`${STATCAN_WDS_BASE}/getDataFromCubePidCoordAndLatestNPeriods`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqs),
      });

      if (!resp.ok) return null;

      const payload = (await resp.json()) as any[];
      for (let i = 0; i < payload.length; i++) {
        const item = payload[i];
        if (item && item.status === 'SUCCESS') {
          const pts = item.object?.vectorDataPoint || [];
          const hasValidValue = pts.some((pt: any) => pt.value != null);
          if (hasValidValue) {
            const matchedCoord = uniqueCandidates[i] || item.object?.coordinate;
            return { coord: matchedCoord, rawPoints: pts };
          }
        }
      }
    } catch {
      // Non-blocking
    }

    return null;
  }

  private frequencyDescription(code?: number): string {
    switch (code) {
      case 1:
        return 'Daily';
      case 6:
        return 'Monthly';
      case 9:
        return 'Quarterly';
      case 11:
        return 'Semi-annual';
      case 12:
        return 'Annual';
      default:
        return 'Occasional';
    }
  }
}
