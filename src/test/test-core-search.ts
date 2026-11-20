import { SearchResult } from '../types.js';
import {
    SUPPORTED_SEARCH_ENGINES,
    distributeLimit,
    normalizeEngineName,
    resolveRequestedEngines
} from '../core/search/searchEngines.js';
import {
    createSearchService,
    SearchEngineExecutorMap
} from '../core/search/searchService.js';

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
    if (actual !== expected) {
        throw new Error(`${label}: expected ${expected}, got ${actual}`);
    }
}

function assertEqualArray(actual: unknown[], expected: unknown[], label: string): void {
    const ok = actual.length === expected.length && actual.every((value, index) => value === expected[index]);
    if (!ok) {
        throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

function createResult(engine: string, index: number): SearchResult {
    return {
        title: `${engine}-${index}`,
        url: `https://${engine}.example.com/${index}`,
        description: `result ${index} from ${engine}`,
        source: `${engine}.example.com`,
        engine
    };
}

function testNormalizeEngineName(): void {
    assertEqual(normalizeEngineName('Bing'), 'bing', 'normalizes Bing');
    assertEqual(normalizeEngineName('duck-duck-go'), 'duckduckgo', 'normalizes duckduckgo alias');
    assertEqual(normalizeEngineName('linux.do'), 'linuxdo', 'normalizes linux.do alias');
    assertEqual(normalizeEngineName('StartPage'), 'startpage', 'normalizes StartPage');
    assertEqual(normalizeEngineName('sou-gou'), 'sogou', 'normalizes sou-gou alias');
    assertEqual(normalizeEngineName('搜狗'), 'sogou', 'normalizes Chinese Sogou alias');
    assertEqual(normalizeEngineName('Hacker News'), 'hackernews', 'normalizes Hacker News alias');
    assertEqual(normalizeEngineName('hn'), 'hackernews', 'normalizes HN alias');
    assertEqual(normalizeEngineName('Keenable'), 'keenable', 'normalizes Keenable');
    assertEqualArray([...SUPPORTED_SEARCH_ENGINES], [
        'baidu',
        'bing',
        'linuxdo',
        'csdn',
        'duckduckgo',
        'exa',
        'brave',
        'juejin',
        'startpage',
        'sogou',
        'hackernews',
        'keenable'
    ], 'supported engines list');
    console.log('✅ normalizeEngineName and supported engines');
}

function testDistributeLimit(): void {
    assertEqualArray(distributeLimit(10, 3), [4, 3, 3], 'distributes remainder to leading engines');
    assertEqualArray(distributeLimit(2, 5), [1, 1, 0, 0, 0], 'supports fewer results than engines');
    console.log('✅ distributeLimit');
}

function testResolveRequestedEngines(): void {
    assertEqualArray(
        resolveRequestedEngines(['bing', 'startpage'], [], 'bing'),
        ['bing', 'startpage'],
        'keeps requested engines when unrestricted'
    );
    assertEqualArray(
        resolveRequestedEngines(['bing', 'startpage'], ['startpage'], 'bing'),
        ['startpage'],
        'filters to allowed engines'
    );
    assertEqualArray(
        resolveRequestedEngines(['bing'], ['startpage'], 'startpage'),
        ['startpage'],
        'falls back to default allowed engine when all requested engines are filtered'
    );
    console.log('✅ resolveRequestedEngines');
}

async function testSearchServiceExecution(): Promise<void> {
    const seenCalls: Array<{ engine: string; query: string; limit: number; searchMode?: string }> = [];
    const engineMap: SearchEngineExecutorMap = {
        bing: async (query, limit, context) => {
            seenCalls.push({ engine: 'bing', query, limit, searchMode: context?.searchMode });
            return Array.from({ length: limit }, (_, index) => createResult('bing', index + 1));
        },
        startpage: async (query, limit, context) => {
            seenCalls.push({ engine: 'startpage', query, limit, searchMode: context?.searchMode });
            throw new Error(`blocked for ${query} (${limit})`);
        }
    };

    const service = createSearchService(engineMap);
    const result = await service.execute({
        query: '  open web search  ',
        engines: ['bing', 'startpage'],
        limit: 3,
        searchMode: 'playwright'
    });

    assertEqual(result.query, 'open web search', 'trims query');
    assertEqual(result.totalResults, 3, 'keeps successful engine results');
    assertEqual(result.partialFailures.length, 1, 'captures one partial failure');
    assertEqual(result.partialFailures[0].engine, 'startpage', 'records failed engine');
    assertEqual(result.partialFailures[0].code, 'engine_error', 'uses stable partial failure code');
    assertEqualArray(
        seenCalls.map(call => `${call.engine}:${call.query}:${call.limit}:${call.searchMode ?? 'none'}`),
        ['bing:open web search:3:playwright', 'startpage:open web search:3:playwright'],
        'passes trimmed query, result limit, and request-level search mode'
    );

    console.log('✅ search service executes with partial failures');
}

async function testMultiEngineMerge(): Promise<void> {
    const shared = 'https://example.com/item?x=1#part';
    const service = createSearchService({
        bing: async (_query, limit) => [
            { ...createResult('bing', 1), url: shared },
            { ...createResult('bing', 2), url: 'https://example.com/item?x=2#part' },
            createResult('bing', 3),
            createResult('bing', 4)
        ].slice(0, limit),
        startpage: async (_query, limit) => [
            createResult('startpage', 1),
            { ...createResult('startpage', 2), url: shared },
            { ...createResult('startpage', 3), url: 'https://example.com/item?x=1#other' },
            createResult('startpage', 4)
        ].slice(0, limit)
    });
    const result = await service.execute({ query: 'test', engines: ['bing', 'startpage'], limit: 5 });
    const results = result.results as Array<SearchResult & { engines: string[] }>;

    assertEqualArray(results.map(item => item.title), ['bing-1', 'startpage-1', 'bing-2', 'bing-3', 'startpage-3'], 'interleaves and fills after duplicates');
    assertEqualArray(results[0].engines, ['bing', 'startpage'], 'records every engine for a shared URL');
    assertEqualArray(results[1].engines, ['startpage'], 'records the engine for a unique URL');
    assertEqual(results[0].url, shared, 'preserves query and anchor');
    assertEqual(results[2].url, 'https://example.com/item?x=2#part', 'keeps distinct query');
    assertEqual(results[4].url, 'https://example.com/item?x=1#other', 'keeps distinct anchor');
    assertEqual(result.totalResults, 5, 'reports the deduplicated result count');

    const lateMatch = createSearchService({
        bing: async () => [{ ...createResult('bing', 1), url: shared }, createResult('bing', 2)],
        startpage: async () => [createResult('startpage', 1), { ...createResult('startpage', 2), url: shared }]
    });
    const limited = await lateMatch.execute({ query: 'test', engines: ['bing', 'startpage'], limit: 2 });
    assertEqualArray(limited.results[0].engines ?? [], ['bing', 'startpage'], 'includes matches beyond the output limit');
}

async function testMultiEngineFailuresAndSingleEngine(): Promise<void> {
    const service = createSearchService({
        bing: async (_query, limit) => Array.from({ length: limit }, (_, index) => createResult('bing', index + 1)),
        startpage: async () => { throw new Error('blocked'); }
    });
    const result = await service.execute({ query: 'test', engines: ['bing', 'startpage', 'missing'], limit: 3 });
    assertEqual(result.totalResults, 3, 'fills limit from the successful engine');
    assertEqualArray(result.partialFailures.map(failure => `${failure.engine}:${failure.code}`).sort(), ['missing:unsupported_engine', 'startpage:engine_error'], 'retains all failures');
    const single = await service.execute({ query: 'test', engines: ['bing'], limit: 2 });
    assertEqualArray(single.results.map(item => item.engine), ['bing', 'bing'], 'retains single-engine result fields and order');
    assertEqualArray((single.results[0] as SearchResult & { engines: string[] }).engines, ['bing'], 'marks single-engine result');
}

async function testSearchServiceAutoModeUsesRuntimeDefault(): Promise<void> {
    const seenCalls: Array<{ searchMode?: string }> = [];
    const service = createSearchService({
        bing: async (query, limit, context) => {
            seenCalls.push({ searchMode: context?.searchMode });
            return Array.from({ length: limit }, (_, index) => createResult(`${query}:${context?.searchMode ?? 'none'}`, index + 1));
        }
    });

    await service.execute({
        query: 'open web search',
        engines: ['bing'],
        limit: 1,
        searchMode: 'auto'
    });

    assertEqual(seenCalls[0].searchMode, undefined, 'request-level auto should be treated like omitted search mode');
    console.log('✅ search service treats request-level auto as runtime default');
}

async function testSearchServiceValidation(): Promise<void> {
    const service = createSearchService({});

    let threw = false;
    try {
        await service.execute({
            query: '   ',
            engines: ['bing'],
            limit: 1
        });
    } catch (error) {
        threw = error instanceof Error && error.message === 'Query string cannot be empty';
    }

    assert(threw, 'empty trimmed query should fail');
    console.log('✅ search service validates empty query');
}

async function main(): Promise<void> {
    testNormalizeEngineName();
    testDistributeLimit();
    testResolveRequestedEngines();
    await testMultiEngineMerge();
    await testMultiEngineFailuresAndSingleEngine();
    await testSearchServiceExecution();
    await testSearchServiceAutoModeUsesRuntimeDefault();
    await testSearchServiceValidation();
    console.log('\nCore search tests passed.');
}

main()
    .then(() => {
        process.exit(0);
    })
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
