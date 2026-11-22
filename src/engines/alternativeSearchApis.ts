import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import axios from 'axios';
import { Readable } from 'node:stream';
import { getProxyUrl } from '../config.js';
import { buildAxiosRequestOptions } from '../utils/httpRequest.js';
import type { SearchEngineExecutor } from '../core/search/searchService.js';
import { asSearchRecord, mapApiSearchHits, readSearchArray, requestSearchJson, SEARCH_API_KEY_ENV } from './searchApiClient.js';

export const alternativeSearchApis = {
    tavily: async (query, limit) => {
        const count = Math.min(20, limit);
        const data = await requestSearchJson('tavily', {
            url: 'https://api.tavily.com/search',
            method: 'POST',
            headers: process.env[SEARCH_API_KEY_ENV.tavily]?.trim() ? undefined : { 'X-Tavily-Access-Mode': 'keyless' },
            auth: { optional: true },
            data: { query, search_depth: 'basic', max_results: count }
        });
        return mapApiSearchHits('tavily', readSearchArray('tavily', data, 'results'), count, hit => {
            const item = asSearchRecord(hit);
            return { url: item?.url, title: item?.title, description: item?.content };
        });
    },
    firecrawl: async (query, limit) => {
        const category = process.env.FIRECRAWL_SEARCH_CATEGORY?.trim() || 'web';
        if (category !== 'web' && category !== 'developer') {
            throw new Error('FIRECRAWL_SEARCH_CATEGORY must be web or developer');
        }
        const data = await requestSearchJson('firecrawl', {
            url: 'https://api.firecrawl.dev/v2/search',
            method: 'POST',
            auth: { optional: true },
            data: category === 'developer' ? { query, limit, categories: ['developer'] } : { query, limit, sources: ['web'] }
        });
        const payload = asSearchRecord(data);
        if (payload?.success !== true) throw new Error('firecrawl returned an unsuccessful search response');
        const results = readSearchArray('firecrawl', payload, 'data', 'web');
        return mapApiSearchHits('firecrawl', results, limit);
    },
    'you.com': async (query, count) => {
        const hasKey = Boolean(process.env[SEARCH_API_KEY_ENV['you.com']]?.trim());
        const data = hasKey
            ? await requestSearchJson('you.com', {
                url: 'https://ydc-index.io/v1/search',
                method: 'POST',
                auth: { header: 'X-API-Key' },
                data: { query, count }
            })
            : await searchYouFree(query, count);
        const response = asSearchRecord(data);
        const results = asSearchRecord(response?.results);
        if (!response || response.error !== undefined || (response.results !== undefined && !results)) {
            throw new Error('you.com returned an invalid search response');
        }
        const web = results?.web === undefined ? [] : readSearchArray('you.com', response, 'results', 'web');
        return mapApiSearchHits('you.com', web, count, hit => {
            const item = asSearchRecord(hit);
            const snippet = Array.isArray(item?.snippets) ? item.snippets.find(value => typeof value === 'string') : undefined;
            return { url: item?.url, title: item?.title, description: snippet ?? item?.description };
        });
    },
    searxng: async (query, limit) => {
        const address = process.env.SEARXNG_URL?.trim();
        if (!address) throw new Error('Set SEARXNG_URL on the server to use searxng');
        const base = parseSearxngUrl(address);
        base.pathname = base.pathname.replace(/\/+$/, '') + '/search';
        const data = await requestSearchJson('searxng', {
            url: base.href,
            method: 'GET',
            params: { q: query, format: 'json' },
            auth: { optional: true },
            direct: true
        });
        return mapApiSearchHits('searxng', readSearchArray('searxng', data, 'results'), limit, hit => {
            const item = asSearchRecord(hit);
            return { url: item?.url, title: item?.title, description: item?.content };
        });
    }
} satisfies Record<string, SearchEngineExecutor>;

function parseSearxngUrl(address: string): URL {
    let url: URL;
    try {
        url = new URL(address);
    } catch {
        throw new Error('SEARXNG_URL must be an HTTP(S) base URL');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error('SEARXNG_URL must be an HTTP(S) base URL without credentials, a query, or a fragment');
    }
    return url;
}

async function searchYouFree(query: string, count: number): Promise<unknown> {
    const client = new Client({ name: 'open-websearch', version: '1.0.0' });
    const timeout = { timeout: 7000 };
    try {
        await client.connect(new StreamableHTTPClientTransport(new URL('https://api.you.com/mcp/free'), {
            requestInit: { redirect: 'error' },
            fetch: getProxyUrl() ? fetchThroughProxy : undefined
        }), timeout);
        const result = await client.callTool({ name: 'you-search', arguments: { query, count } }, undefined, timeout);
        if (result.isError) throw new Error('search failed');
        if (result.structuredContent) return result.structuredContent;
        const item = Array.isArray(result.content)
            ? result.content.map(asSearchRecord).find(block => block?.type === 'text')
            : undefined;
        const text = item?.text;
        return typeof text === 'string' ? JSON.parse(text) : undefined;
    } catch {
        throw new Error('you.com free MCP search failed');
    } finally {
        await client.close().catch(() => {});
    }
}

async function fetchThroughProxy(url: string | URL, init?: RequestInit): Promise<Response> {
    const response = await axios.request<Readable>({
        ...buildAxiosRequestOptions({
            trustedStaticHost: true,
            headers: Object.fromEntries(new Headers(init?.headers)),
            responseType: 'stream',
            validateStatus: () => true
        }),
        url: String(url),
        method: init?.method,
        data: init?.body,
        signal: init?.signal ?? undefined
    });
    if (response.status >= 300 && response.status < 400 && response.headers.location) {
        response.data.destroy();
        throw new Error('Unexpected redirect from You.com');
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(response.headers)) {
        if (typeof value === 'string') headers.set(name, value);
        else if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    }
    if ([204, 205, 304].includes(response.status)) {
        response.data.resume();
        return new Response(null, { status: response.status, headers });
    }
    const body = Readable.toWeb(response.data) as ReadableStream<Uint8Array>;
    return new Response(body, { status: response.status, headers });
}
