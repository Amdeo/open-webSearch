import axios from 'axios';
import { config } from '../config.js';
import { AllSearchEnginesFailedError, createSearchService } from '../core/search/searchService.js';
import { searchExa } from '../engines/exa/exa.js';
import { searchDuckDuckGo } from '../engines/duckduckgo/searchDuckDuckGo.js';
import { searchJuejin } from '../engines/juejin/juejin.js';
import { searchLinuxDo } from '../engines/linuxdo/linuxdo.js';

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
    const originalGet = axios.get;
    const originalPost = axios.post;
    const originalEngine = config.defaultSearchEngine;
    const failures: string[] = [];
    const check = async (name: string, run: () => Promise<void>) => {
        try { await run(); console.log(`✓ ${name}`); }
        catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
    };
    const service = createSearchService({ exa: searchExa, duckduckgo: searchDuckDuckGo, juejin: searchJuejin, linuxdo: searchLinuxDo });
    const execute = (engine: string) => service.execute({ query: 'test', engines: [engine], limit: 2 });
    const getFailure = async (search: ReturnType<typeof execute>) => {
        const error = await search.catch((caught: unknown) => caught);
        assert(error instanceof AllSearchEnginesFailedError, 'a search whose engines all fail must reject');
        return error;
    };
    const reject = async () => { throw new Error('offline failure'); };
    const respond = (data: unknown) => Promise.resolve({ data, status: 200, statusText: 'OK', headers: {}, config: {} });

    try {
        axios.get = reject as typeof axios.get;
        axios.post = reject as typeof axios.post;
        for (const engine of ['exa', 'duckduckgo', 'juejin', 'linuxdo']) {
            await check(`${engine} terminal network failure`, async () => {
                config.defaultSearchEngine = 'brave';
                const result = await getFailure(execute(engine));
                assert(result.partialFailures.length === 1 && result.partialFailures[0].engine === engine, 'failure must reach partialFailures');
            });
        }
        await check('multiple failed engines are all reported', async () => {
            config.defaultSearchEngine = 'duckduckgo';
            const result = await getFailure(service.execute({ query: 'test', engines: ['exa', 'duckduckgo', 'juejin', 'linuxdo'], limit: 2 }));
            assert(result.partialFailures.map(failure => failure.engine).sort().join(',') === 'duckduckgo,exa,juejin,linuxdo', 'all terminal failures must be reported');
        });
        await check('juejin business error', async () => {
            axios.get = (() => respond({ err_no: 42, err_msg: 'business failure' })) as typeof axios.get;
            const result = await getFailure(execute('juejin'));
            assert(result.partialFailures.length === 1 && result.partialFailures[0].message.includes('business failure'), 'business error must reach partialFailures');
        });
        await check('empty results remain successful', async () => {
            axios.get = ((url: string) => url.includes('juejin') ? respond({ err_no: 0, data: [], has_more: false }) : respond('<html></html>')) as typeof axios.get;
            axios.post = ((url: string) => url.includes('exa.ai') ? respond({ results: [] }) : respond('<html></html>')) as typeof axios.post;
            for (const engine of ['exa', 'duckduckgo', 'juejin', 'linuxdo']) {
                const result = await execute(engine);
                assert(result.results.length === 0 && result.partialFailures.length === 0, `${engine} empty response should succeed`);
            }
        });
        await check('duckduckgo falls back to HTML after preload failure', async () => {
            axios.get = reject as typeof axios.get;
            axios.post = (() => respond('<div class="result"><a class="result__a" href="https://example.com">Result</a></div>')) as typeof axios.post;
            const result = await service.execute({ query: 'test', engines: ['duckduckgo'], limit: 1 });
            assert(result.results.length === 1 && result.partialFailures.length === 0, 'HTML fallback should succeed');
        });
        await check('linuxdo falls back after DuckDuckGo failure', async () => {
            config.defaultSearchEngine = 'duckduckgo';
            axios.get = ((url: string) => url.includes('search.brave.com') ? respond('<div id="results"><div class="snippet"><div class="result-content"><a href="https://linux.do/t/topic/1"><span class="search-snippet-title">Result</span></a></div></div></div>') : reject()) as typeof axios.get;
            axios.post = reject as typeof axios.post;
            const result = await service.execute({ query: 'test', engines: ['linuxdo'], limit: 1 });
            assert(result.results.length === 1 && result.partialFailures.length === 0, 'Brave fallback should succeed');
        });
    } finally {
        axios.get = originalGet;
        axios.post = originalPost;
        config.defaultSearchEngine = originalEngine;
    }
    if (failures.length) throw new Error(failures.join('\n'));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
