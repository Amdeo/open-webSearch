import type { SearchEngineExecutor } from '../core/search/searchService.js';
import { asSearchRecord, mapApiSearchHits, readSearchArray, requestSearchJson } from './searchApiClient.js';

function clampLimit(limit: number, maximum: number): number {
    return Math.min(maximum, Math.max(1, Math.floor(limit)));
}

export const internationalSearchApis = {
    perplexity: async (query, limit) => {
        const maxResults = clampLimit(limit, 20);
        const searchType = process.env.PERPLEXITY_SEARCH_TYPE?.trim().toLowerCase() === 'fast' ? 'fast' : 'web';
        const data = await requestSearchJson('perplexity', {
            url: 'https://api.perplexity.ai/search',
            method: 'POST',
            data: { query, max_results: maxResults, search_type: searchType }
        });
        return mapApiSearchHits('perplexity', readSearchArray('perplexity', data, 'results'), maxResults, hit => {
            const item = asSearchRecord(hit);
            return { url: item?.url, title: item?.title, description: item?.snippet };
        });
    },
    linkup: async (query, limit) => {
        const maxResults = Math.max(1, Math.floor(limit));
        const data = await requestSearchJson('linkup', {
            url: 'https://api.linkup.so/v1/search',
            method: 'POST',
            data: { q: query, depth: 'standard', outputType: 'searchResults', maxResults }
        });
        return mapApiSearchHits('linkup', readSearchArray('linkup', data, 'results'), maxResults, hit => {
            const item = asSearchRecord(hit);
            return { url: item?.url, title: item?.name, description: item?.content };
        });
    },
    kagi: async (query, limit) => {
        const maxResults = clampLimit(limit, 1024);
        const data = await requestSearchJson('kagi', {
            url: 'https://kagi.com/api/v1/search',
            method: 'POST',
            data: { query, limit: maxResults }
        });
        const payload = asSearchRecord(data);
        const section = asSearchRecord(payload?.data);
        if (!section) throw new Error('kagi returned an invalid search response');
        const hits = section.search == null ? [] : readSearchArray('kagi', section, 'search');
        return mapApiSearchHits('kagi', hits, maxResults, hit => {
            const item = asSearchRecord(hit);
            return { url: item?.url, title: item?.title, description: item?.snippet };
        });
    },
    tinyfish: async (query, limit) => {
        const maxResults = Math.max(1, Math.floor(limit));
        const data = await requestSearchJson('tinyfish', {
            url: 'https://api.search.tinyfish.ai',
            method: 'GET',
            params: { query },
            auth: { header: 'X-API-Key' }
        });
        return mapApiSearchHits('tinyfish', readSearchArray('tinyfish', data, 'results'), maxResults, hit => {
            const item = asSearchRecord(hit);
            return { url: item?.url, title: item?.title, description: item?.snippet };
        });
    },
    serper: async (query, limit) => {
        const num = clampLimit(limit, 100);
        const data = await requestSearchJson('serper', {
            url: 'https://google.serper.dev/search',
            method: 'POST',
            auth: { header: 'X-API-KEY' },
            data: { q: query, num }
        });
        const payload = asSearchRecord(data);
        if (!payload) throw new Error('serper returned an invalid search response');
        const hits = payload.organic == null ? [] : readSearchArray('serper', payload, 'organic');
        return mapApiSearchHits('serper', hits, num, hit => {
            const item = asSearchRecord(hit);
            return { url: item?.link, title: item?.title, description: item?.snippet };
        });
    },
    serpapi: async (query, limit) => {
        const num = clampLimit(limit, 100);
        const data = await requestSearchJson('serpapi', {
            url: 'https://serpapi.com/search.json',
            method: 'GET',
            params: { engine: 'google', q: query, num },
            auth: { query: 'api_key' }
        });
        const payload = asSearchRecord(data);
        if (!payload) throw new Error('serpapi returned an invalid search response');
        if (payload.error != null) {
            throw new Error('serpapi returned an unsuccessful search response');
        }
        if (asSearchRecord(payload.search_metadata)?.status === 'Error') {
            throw new Error('serpapi returned an unsuccessful search response');
        }
        const hits = payload.organic_results == null ? [] : readSearchArray('serpapi', payload, 'organic_results');
        return mapApiSearchHits('serpapi', hits, num, hit => {
            const item = asSearchRecord(hit);
            return { url: item?.link, title: item?.title, description: item?.snippet };
        });
    }
} satisfies Record<string, SearchEngineExecutor>;
