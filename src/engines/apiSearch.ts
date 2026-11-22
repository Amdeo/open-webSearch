import { z } from 'zod';
import type { SearchResult } from '../types.js';
import { mapApiSearchHits, requestSearchJson } from './searchApiClient.js';

const providers = {
    'exa-api': {
        url: 'https://api.exa.ai/search',
        method: 'POST',
        keyHeader: 'x-api-key'
    },
    'brave-api': {
        url: 'https://api.search.brave.com/res/v1/web/search',
        method: 'GET',
        keyHeader: 'X-Subscription-Token'
    }
} as const;

type ApiEngine = keyof typeof providers;
const exaResponse = z.object({ results: z.array(z.unknown()) });
const braveResponse = z.object({
    type: z.literal('search'),
    web: z.object({ results: z.array(z.unknown()) }).optional()
});
const searchHit = z.object({
    url: z.string(),
    title: z.string().nullish(),
    description: z.string().nullish(),
    highlights: z.array(z.string()).nullish()
});

export async function searchExaApi(query: string, limit: number): Promise<SearchResult[]> {
    const numResults = Math.min(100, Math.floor(limit));
    const data = await requestSearchApi('exa-api', {
        data: { query, numResults, contents: { highlights: true } }
    });
    const payload = exaResponse.safeParse(data);
    if (!payload.success) throw new Error('exa-api returned an invalid search response');
    return mapSearchHits('exa-api', payload.data.results, numResults);
}

export async function searchBraveApi(query: string, limit: number): Promise<SearchResult[]> {
    const count = Math.min(20, Math.floor(limit));
    const data = await requestSearchApi('brave-api', {
        params: { q: query, count, text_decorations: false }
    });
    const payload = braveResponse.safeParse(data);
    if (!payload.success) throw new Error('brave-api returned an invalid search response');
    return mapSearchHits('brave-api', payload.data.web?.results ?? [], count);
}

async function requestSearchApi(
    engine: ApiEngine,
    payload: { data?: Record<string, unknown>; params?: Record<string, string | number | boolean> }
): Promise<unknown> {
    const { url, method, keyHeader } = providers[engine];
    return requestSearchJson(engine, { url, method, auth: { header: keyHeader }, ...payload });
}

function mapSearchHits(engine: ApiEngine, hits: unknown[], limit: number): SearchResult[] {
    return mapApiSearchHits(engine, hits, limit, hit => {
        const parsed = searchHit.safeParse(hit);
        if (!parsed.success) return undefined;
        const { url, title, description, highlights } = parsed.data;
        return { url, title, description: description || highlights?.[0] };
    });
}
