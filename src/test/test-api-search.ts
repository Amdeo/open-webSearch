import assert from 'node:assert/strict';
import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { normalizeEngineName } from '../core/search/searchEngines.js';
import { createOpenWebSearchRuntime } from '../runtime/createRuntime.js';

async function main(): Promise<void> {
    const originalAdapter = axios.defaults.adapter;
    const originalExaKey = process.env.EXA_API_KEY;
    const originalBraveKey = process.env.BRAVE_SEARCH_API_KEY;
    const runtime = createOpenWebSearchRuntime();
    const requests: InternalAxiosRequestConfig[] = [];
    const execute = (engines: string[]) => runtime.services.search.execute({
        query: 'SQLite WAL',
        engines: engines.map(normalizeEngineName),
        limit: 50
    });
    const fakeBraveKey = 'fixture-value';
    const url = 'https://www.sqlite.org/wal.html';

    try {
        delete process.env.EXA_API_KEY;
        process.env.BRAVE_SEARCH_API_KEY = '   ';
        axios.defaults.adapter = async request => {
            requests.push(request);
            const data = request.url === 'https://api.exa.ai/search'
                ? { results: [
                    { title: 'Local address', url: 'http://127.0.0.1/' },
                    { title: 'Write-Ahead Logging', url, highlights: ['SQLite WAL documentation'] }
                ] }
                : { type: 'search', web: { results: [
                    { title: 'WAL', url, description: 'SQLite reference' },
                    { title: 'SQLite', url: 'https://www.sqlite.org/' }
                ] } };
            return { data, status: 200, statusText: 'OK', headers: {}, config: request };
        };

        await assert.rejects(execute(['exa-api', 'brave-api']), {
            code: 'all_engines_failed',
            partialFailures: [
                { engine: 'exa-api', code: 'missing_api_key', message: 'Set EXA_API_KEY on the server to use exa-api' },
                { engine: 'brave-api', code: 'missing_api_key', message: 'Set BRAVE_SEARCH_API_KEY on the server to use brave-api' }
            ]
        });
        assert.equal(requests.length, 0);

        process.env.EXA_API_KEY = ' test-exa-key ';
        process.env.BRAVE_SEARCH_API_KEY = fakeBraveKey;
        const result = await execute(['Exa API', 'Brave API', 'exa-api']);
        assert.deepEqual(result.partialFailures, []);
        assert.deepEqual(result.results.map(item => [item.url, item.engines]), [
            [url, ['exa-api', 'brave-api']],
            ['https://www.sqlite.org/', ['brave-api']]
        ]);
        assert.equal(result.results[0].description, 'SQLite WAL documentation');
        assert.equal(requests.length, 2);

        const [exa, brave] = requests;
        assert.equal(exa.url, 'https://api.exa.ai/search');
        assert.equal(exa.method, 'post');
        assert.equal(exa.headers.get('x-api-key'), 'test-exa-key');
        assert.deepEqual(JSON.parse(exa.data), { query: 'SQLite WAL', numResults: 50, contents: { highlights: true } });
        assert.equal(brave.url, 'https://api.search.brave.com/res/v1/web/search');
        assert.equal(brave.method, 'get');
        assert.equal(brave.headers.get('X-Subscription-Token'), fakeBraveKey);
        assert.deepEqual(brave.params, { q: 'SQLite WAL', count: 20, text_decorations: false });
        assert.equal(exa.maxRedirects, 0);
        assert.equal(brave.maxRedirects, 0);

        axios.defaults.adapter = async request => {
            const response = { data: 'test-exa-key', status: 429, statusText: 'Too Many Requests', headers: {}, config: request };
            throw new AxiosError('Provider echoed test-exa-key', AxiosError.ERR_BAD_REQUEST, request, undefined, response);
        };
        await assert.rejects(execute(['exa-api']), {
            code: 'all_engines_failed',
            partialFailures: [{ engine: 'exa-api', code: 'api_http_error', message: 'exa-api returned HTTP 429' }]
        });

        console.log('✓ API search credentials, request budgets, deduplication, and redacted failures');
    } finally {
        axios.defaults.adapter = originalAdapter;
        if (originalExaKey === undefined) delete process.env.EXA_API_KEY;
        else process.env.EXA_API_KEY = originalExaKey;
        if (originalBraveKey === undefined) delete process.env.BRAVE_SEARCH_API_KEY;
        else process.env.BRAVE_SEARCH_API_KEY = originalBraveKey;
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
