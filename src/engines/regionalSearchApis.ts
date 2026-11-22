import type { SearchEngineExecutor } from '../core/search/searchService.js';
import type { SearchResult } from '../types.js';
import {
    asSearchRecord,
    mapApiSearchHits,
    readSearchArray,
    requestSearchJson
} from './searchApiClient.js';

const DEEPSEEK_SEARCH_URL = 'https://api.deepseek.com/v1/tools/search';
const DOUBAO_SEARCH_URL = 'https://open.feedcoopapi.com/search_api/web_search';
const YUANBAO_SEARCH_URL = 'https://api.wsa.cloud.tencent.com/SearchPro';
const ZHIPU_SEARCH_URL = 'https://open.bigmodel.cn/api/paas/v4/web_search';
const BAIDU_SEARCH_URL = 'https://qianfan.baidubce.com/v2/ai_search/web_search';
const BOCHA_SEARCH_URL = 'https://api.bochaai.com/v1/web-search';
const ALIYUN_IQS_SEARCH_URL = 'https://cloud-iqs.aliyuncs.com/search/unified';

const ZHIPU_SEARCH_ENGINES: Record<string, string> = {
    std: 'search_std',
    search_std: 'search_std',
    pro: 'search_pro',
    search_pro: 'search_pro',
    sogou: 'search_pro_sogou',
    search_pro_sogou: 'search_pro_sogou',
    quark: 'search_pro_quark',
    search_pro_quark: 'search_pro_quark'
};

export async function searchDeepseek(query: string, limit: number): Promise<SearchResult[]> {
    const count = clampCount(limit, 50);
    const response = await requestSearchJson('deepseek', {
        url: DEEPSEEK_SEARCH_URL,
        method: 'POST',
        data: {
            query: validatedQuery('deepseek', query, 128),
            count,
            need_content: false
        }
    });

    if (asSearchRecord(response)?.error) throw serviceError('deepseek');
    const hits = readSearchArray('deepseek', response, 'results');
    return mapApiSearchHits('deepseek', hits, count, hit => {
        const item = asSearchRecord(hit);
        return {
            url: item?.url,
            title: item?.title,
            description: firstString(item?.summary, item?.snippet)
        };
    });
}

export async function searchDoubao(query: string, limit: number): Promise<SearchResult[]> {
    const count = clampCount(limit, 50);
    const response = await requestSearchJson('doubao', {
        url: DOUBAO_SEARCH_URL,
        method: 'POST',
        data: {
            Query: validatedQuery('doubao', query, 100),
            SearchType: 'web',
            Count: count,
            Filter: { NeedUrl: true }
        }
    });

    const envelope = asSearchRecord(response);
    if (asSearchRecord(envelope?.ResponseMetadata)?.Error) throw serviceError('doubao');
    const result = asSearchRecord(envelope?.Result);
    if (!result) throw new Error('doubao 返回了无法解析的搜索结果');
    const hits = result.WebResults == null ? [] : readSearchArray('doubao', result, 'WebResults');
    return mapApiSearchHits('doubao', hits, count, hit => {
        const item = asSearchRecord(hit);
        return {
            url: item?.Url,
            title: item?.Title,
            description: firstString(item?.Summary, item?.Snippet)
        };
    });
}

export async function searchYuanbao(query: string, limit: number): Promise<SearchResult[]> {
    const response = await requestSearchJson('yuanbao', {
        url: YUANBAO_SEARCH_URL,
        method: 'POST',
        data: {
            Query: query,
            ...(process.env.YUANBAO_SEARCH_SPEED !== 'true' && {
                Cnt: nextAllowedCount(limit, [10, 20, 30, 40, 50])
            })
        }
    });

    const envelope = asSearchRecord(asSearchRecord(response)?.Response);
    if (!envelope) throw new Error('yuanbao 返回了无法解析的搜索结果');
    if (envelope.Error) throw serviceError('yuanbao');
    const pages = readSearchArray('yuanbao', envelope, 'Pages');
    const hits: unknown[] = [];
    for (const page of pages) {
        const parsed = parseJsonRecord(page);
        if (parsed) hits.push(parsed);
    }

    return mapApiSearchHits('yuanbao', hits, limit, hit => {
        const item = asSearchRecord(hit);
        return {
            url: item?.url,
            title: item?.title,
            description: firstString(item?.passage, item?.content)
        };
    });
}

export async function searchZhipu(query: string, limit: number): Promise<SearchResult[]> {
    const engine = resolveZhipuEngine(process.env.ZHIPU_SEARCH_ENGINE);
    const count = engine === 'search_pro_sogou'
        ? nextAllowedCount(limit, [10, 20, 30, 40, 50])
        : clampCount(limit, 50);
    const response = await requestSearchJson('zhipu', {
        url: ZHIPU_SEARCH_URL,
        method: 'POST',
        data: {
            search_query: validatedQuery('zhipu', query, 70),
            search_engine: engine,
            search_intent: false,
            ...(engine !== 'search_pro_quark' && { count }),
            content_size: 'medium'
        }
    });

    if (asSearchRecord(response)?.error) throw serviceError('zhipu');
    const hits = readSearchArray('zhipu', response, 'search_result');
    return mapApiSearchHits('zhipu', hits, limit, hit => {
        const item = asSearchRecord(hit);
        return {
            url: item?.link,
            title: item?.title,
            description: item?.content
        };
    });
}

export async function searchBaiduApi(query: string, limit: number): Promise<SearchResult[]> {
    const count = clampCount(limit, 50);
    const response = await requestSearchJson('baidu-api', {
        url: BAIDU_SEARCH_URL,
        method: 'POST',
        data: {
            messages: [{ role: 'user', content: validatedQuery('baidu-api', query, 72, true) }],
            search_source: 'baidu_search_v2',
            resource_type_filter: [{ type: 'web', top_k: count }],
            edition: 'standard'
        }
    });

    const record = asSearchRecord(response);
    if (isDeclaredError(record?.code)) throw serviceError('baidu-api');
    const hits = readSearchArray('baidu-api', record, 'references');
    return mapApiSearchHits('baidu-api', hits, count, hit => {
        const item = asSearchRecord(hit);
        if (typeof item?.type === 'string' && item.type !== 'web') return undefined;
        return {
            url: item?.url,
            title: item?.title,
            description: firstString(item?.snippet, item?.content)
        };
    });
}

export async function searchBocha(query: string, limit: number): Promise<SearchResult[]> {
    const count = clampCount(limit, 50);
    const response = await requestSearchJson('bocha', {
        url: BOCHA_SEARCH_URL,
        method: 'POST',
        data: {
            query,
            summary: true,
            count
        }
    });

    const record = asSearchRecord(response);
    if (isDeclaredError(record?.code)) throw serviceError('bocha');
    const hits = readSearchArray('bocha', record, 'data', 'webPages', 'value');
    return mapApiSearchHits('bocha', hits, count, hit => {
        const item = asSearchRecord(hit);
        return {
            url: item?.url,
            title: item?.name,
            description: firstString(item?.summary, item?.snippet)
        };
    });
}

export async function searchAliyunIqs(query: string, limit: number): Promise<SearchResult[]> {
    const count = clampCount(limit, 50);
    const response = await requestSearchJson('aliyun-iqs', {
        url: ALIYUN_IQS_SEARCH_URL,
        method: 'POST',
        data: {
            query: validatedQuery('aliyun-iqs', query, 500),
            engineType: 'CNLiteBasic',
            contents: {
                mainText: false,
                markdownText: false,
                summary: false,
                rerankScore: true
            },
            advancedParams: { numResults: String(count) }
        }
    });

    const record = asSearchRecord(response);
    if (isDeclaredError(record?.code)) throw serviceError('aliyun-iqs');
    const hits = readSearchArray('aliyun-iqs', record, 'pageItems');
    return mapApiSearchHits('aliyun-iqs', hits, count, hit => {
        const item = asSearchRecord(hit);
        return {
            url: item?.link,
            title: item?.title,
            description: firstString(item?.summary, item?.snippet)
        };
    });
}

export const regionalSearchApis = {
    deepseek: searchDeepseek,
    doubao: searchDoubao,
    yuanbao: searchYuanbao,
    zhipu: searchZhipu,
    'baidu-api': searchBaiduApi,
    bocha: searchBocha,
    'aliyun-iqs': searchAliyunIqs
} satisfies Record<string, SearchEngineExecutor>;

function clampCount(limit: number, max: number): number {
    return Math.max(1, Math.min(max, Math.floor(limit)));
}

function nextAllowedCount(limit: number, allowed: number[]): number {
    const requested = Math.max(1, Math.floor(limit));
    return allowed.find(count => requested <= count) ?? allowed[allowed.length - 1];
}

function validatedQuery(engine: string, query: string, maxLength: number, weighted = false): string {
    // Baidu counts non-ASCII characters twice.
    const length = Array.from(query).reduce((total, character) =>
        total + (weighted && (character.codePointAt(0) ?? 0) > 0x7f ? 2 : 1), 0);
    if (length > maxLength) {
        const units = weighted ? 'characters (non-ASCII characters count as two)' : 'characters';
        throw Object.assign(new Error(`${engine} query must be at most ${maxLength} ${units}`), { code: 'query_too_long' });
    }
    return query;
}

function parseJsonRecord(value: unknown): Record<string, unknown> | undefined {
    if (typeof value === 'string') {
        try {
            return asSearchRecord(JSON.parse(value));
        } catch {
            return undefined;
        }
    }
    return asSearchRecord(value);
}

function firstString(...values: unknown[]): string | undefined {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value;
    }
    return undefined;
}

function isDeclaredError(code: unknown): boolean {
    if (code === undefined || code === null) return false;
    if (typeof code === 'string' && !code.trim()) return false;
    const normalized = String(code).trim();
    return normalized !== '0' && normalized !== '200';
}

function resolveZhipuEngine(value: string | undefined): string {
    const configured = value?.trim().toLowerCase();
    if (!configured) return 'search_std';
    if (!Object.hasOwn(ZHIPU_SEARCH_ENGINES, configured)) {
        throw new Error('ZHIPU_SEARCH_ENGINE 仅支持 std、pro、sogou、quark（或 search_std、search_pro、search_pro_sogou、search_pro_quark）');
    }
    return ZHIPU_SEARCH_ENGINES[configured];
}

function serviceError(engine: string): Error {
    return new Error(`${engine} 搜索服务返回错误`);
}

