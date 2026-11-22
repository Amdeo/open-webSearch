import axios from 'axios';
import type { SearchResult } from '../types.js';
import { buildAxiosRequestOptions } from '../utils/httpRequest.js';
import { isPrivateOrLocalHostname } from '../utils/urlSafety.js';

export const SEARCH_API_KEY_ENV = {
    'exa-api': 'EXA_API_KEY',
    'brave-api': 'BRAVE_SEARCH_API_KEY',
    tavily: 'TAVILY_API_KEY',
    firecrawl: 'FIRECRAWL_API_KEY',
    'you.com': 'YDC_API_KEY',
    searxng: 'SEARXNG_API_KEY',
    perplexity: 'PERPLEXITY_API_KEY',
    linkup: 'LINKUP_API_KEY',
    kagi: 'KAGI_API_KEY',
    tinyfish: 'TINYFISH_API_KEY',
    serper: 'SERPER_API_KEY',
    serpapi: 'SERPAPI_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    doubao: 'DOUBAO_SEARCH_API_KEY',
    yuanbao: 'YUANBAO_SEARCH_API_KEY',
    zhipu: 'ZHIPUAI_API_KEY',
    'baidu-api': 'QIANFAN_API_KEY',
    bocha: 'BOCHA_API_KEY',
    'aliyun-iqs': 'ALIYUN_IQS_API_KEY'
} as const;

export function hasSearchApiCredentials(allowedEngines: readonly string[]): boolean {
    return Object.entries(SEARCH_API_KEY_ENV).some(([engine, env]) =>
        (allowedEngines.length === 0 || allowedEngines.includes(engine)) && Boolean(process.env[env]?.trim())
    );
}

type SearchApiRequest = {
    url: string;
    method: 'GET' | 'POST';
    data?: Record<string, unknown>;
    params?: Record<string, string | number | boolean>;
    headers?: Record<string, string>;
    auth?: {
        header?: string;
        query?: string;
        optional?: boolean;
    };
    direct?: boolean;
};

type SearchApiHit = {
    url?: unknown;
    title?: unknown;
    description?: unknown;
};

export async function requestSearchJson(engine: keyof typeof SEARCH_API_KEY_ENV, request: SearchApiRequest): Promise<unknown> {
    const { auth } = request;
    const keyEnv = SEARCH_API_KEY_ENV[engine];
    const key = process.env[keyEnv]?.trim();
    if (!auth?.optional && !key) {
        throw Object.assign(new Error(`Set ${keyEnv} on the server to use ${engine}`), { code: 'missing_api_key' });
    }

    const headers: Record<string, string> = { Accept: 'application/json', ...request.headers };
    let params = request.params;
    if (key) {
        if (auth?.query) params = { ...params, [auth.query]: key };
        else if (auth?.header) headers[auth.header] = key;
        else headers.Authorization = `Bearer ${key}`;
    }

    const options = {
        headers,
        params,
        responseType: 'json' as const,
        timeout: 15_000,
        maxContentLength: 2 * 1024 * 1024
    };
    try {
        const response = await axios.request<unknown>({
            ...(request.direct
                ? { ...options, proxy: false as const, maxRedirects: 0 }
                : buildAxiosRequestOptions({ ...options, trustedStaticHost: true })),
            url: request.url,
            method: request.method,
            data: request.data
        });
        return response.data;
    } catch (error) {
        // Axios errors may embed credentials, including in URL parameters and response bodies.
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        if (typeof status === 'number') {
            throw Object.assign(new Error(`${engine} returned HTTP ${status}`), { code: 'api_http_error' });
        }
        throw new Error(`${engine} request failed`);
    }
}

export function asSearchRecord(value: unknown): Record<string, unknown> | undefined {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    return undefined;
}

export function readSearchArray(engine: string, response: unknown, ...path: string[]): unknown[] {
    let value = response;
    for (const part of path) value = asSearchRecord(value)?.[part];
    if (!Array.isArray(value)) throw new Error(`${engine} returned an invalid search response`);
    return value;
}

export function mapApiSearchHits(
    engine: string,
    hits: unknown[],
    limit: number,
    map?: (hit: unknown) => SearchApiHit | undefined
): SearchResult[] {
    const results: SearchResult[] = [];
    for (const hit of hits) {
        const item = map ? map(hit) : asSearchRecord(hit);
        if (typeof item?.url !== 'string') continue;
        let target: URL;
        try {
            target = new URL(item.url);
        } catch {
            continue;
        }
        if ((target.protocol !== 'http:' && target.protocol !== 'https:') || target.username || target.password
            || isPrivateOrLocalHostname(target.hostname)) continue;
        const title = typeof item.title === 'string' ? item.title.trim() : '';

        results.push({
            title: title || target.hostname,
            url: target.href,
            description: typeof item.description === 'string' ? item.description.trim().slice(0, 1000) : '',
            source: target.hostname,
            engine
        });
        if (results.length >= limit) break;
    }
    return results;
}
