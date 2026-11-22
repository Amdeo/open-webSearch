import assert from 'node:assert/strict';
import axios, { type InternalAxiosRequestConfig } from 'axios';
import { internationalSearchApis } from '../engines/internationalSearchApis.js';

const keys = [
    'PERPLEXITY_API_KEY',
    'LINKUP_API_KEY',
    'KAGI_API_KEY',
    'TINYFISH_API_KEY',
    'SERPER_API_KEY',
    'SERPAPI_API_KEY'
] as const;
const previousKeys = keys.map(key => process.env[key]);
const previousSearchType = process.env.PERPLEXITY_SEARCH_TYPE;
const originalAdapter = axios.defaults.adapter;
const requests: InternalAxiosRequestConfig[] = [];
const replies = new Map<string, unknown>();
const query = 'SQLite WAL documentation';
const sample = { title: 'SQLite WAL', url: 'https://www.sqlite.org/wal.html' };

function lastRequest(): InternalAxiosRequestConfig {
    const request = requests.at(-1);
    assert.ok(request);
    return request;
}

async function main(): Promise<void> {
    try {
        for (const key of keys) delete process.env[key];
        delete process.env.PERPLEXITY_SEARCH_TYPE;
        axios.defaults.adapter = async config => {
            requests.push(config);
            return { config, status: 200, statusText: 'OK', headers: {}, data: replies.get(config.url ?? '') };
        };

        const missingKeyCases = [
            ['perplexity', 'PERPLEXITY_API_KEY'],
            ['linkup', 'LINKUP_API_KEY'],
            ['kagi', 'KAGI_API_KEY'],
            ['tinyfish', 'TINYFISH_API_KEY'],
            ['serper', 'SERPER_API_KEY'],
            ['serpapi', 'SERPAPI_API_KEY']
        ] as const;
        for (const [engine, key] of missingKeyCases) {
            await assert.rejects(internationalSearchApis[engine](query, 5), new RegExp(key));
        }
        assert.equal(requests.length, 0);

        keys.forEach((key, index) => {
            const name = missingKeyCases[index][0];
            process.env[key] = name === 'perplexity' ? ' fixture-perplexity ' : `fixture-${name}`;
        });

        replies.set('https://api.perplexity.ai/search', {
            results: [
                { ...sample, snippet: 'SQLite WAL documentation' },
                { title: 'Private address', url: 'http://127.0.0.1/private', snippet: 'not public' },
                { title: 'Credential address', url: 'https://user:secret@example.com/', snippet: 'not public' }
            ]
        });
        const perplexity = await internationalSearchApis.perplexity(query, 50);
        assert.equal(perplexity.length, 1);
        assert.equal(perplexity[0].description, 'SQLite WAL documentation');
        assert.equal(perplexity[0].source, 'www.sqlite.org');
        let request = lastRequest();
        assert.equal(request.url, 'https://api.perplexity.ai/search');
        assert.equal(request.method, 'post');
        assert.equal(request.headers.get('Authorization'), 'Bearer fixture-perplexity');
        assert.deepEqual(JSON.parse(request.data as string), {
            query,
            max_results: 20,
            search_type: 'web'
        });
        assert.equal(request.proxy, false);
        assert.equal(request.maxRedirects, 0);

        process.env.PERPLEXITY_SEARCH_TYPE = 'FAST';
        await internationalSearchApis.perplexity(query, 3);
        assert.deepEqual(JSON.parse(lastRequest().data as string), {
            query,
            max_results: 3,
            search_type: 'fast'
        });

        replies.set('https://api.linkup.so/v1/search', {
            results: [
                { type: 'text', name: sample.title, url: sample.url, content: 'Linkup content' },
                { type: 'image', name: 'image', url: '', content: '' }
            ]
        });
        const linkup = await internationalSearchApis.linkup(query, 5);
        assert.equal(linkup.length, 1);
        assert.equal(linkup[0].description, 'Linkup content');
        request = lastRequest();
        assert.equal(request.method, 'post');
        assert.equal(request.headers.get('Authorization'), 'Bearer fixture-linkup');
        assert.deepEqual(JSON.parse(request.data as string), {
            q: query,
            depth: 'standard',
            outputType: 'searchResults',
            maxResults: 5
        });

        replies.set('https://kagi.com/api/v1/search', {
            meta: { trace: 'fixture-trace' },
            data: {
                search: [
                    { ...sample, snippet: 'Kagi snippet' },
                    { title: 'Private address', url: 'http://localhost/private', snippet: 'not public' }
                ]
            }
        });
        const kagi = await internationalSearchApis.kagi(query, 5000);
        assert.equal(kagi.length, 1);
        assert.equal(kagi[0].description, 'Kagi snippet');
        request = lastRequest();
        assert.equal(request.url, 'https://kagi.com/api/v1/search');
        assert.equal(request.headers.get('Authorization'), 'Bearer fixture-kagi');
        assert.deepEqual(JSON.parse(request.data as string), { query, limit: 1024 });

        replies.set('https://api.search.tinyfish.ai', {
            query,
            results: [
                { position: 1, site_name: 'www.sqlite.org', ...sample, snippet: 'TinyFish snippet' },
                { position: 2, site_name: 'www.sqlite.org', ...sample, snippet: 'second result' }
            ],
            total_results: 2,
            page: 0
        });
        const tinyfish = await internationalSearchApis.tinyfish(query, 1);
        assert.equal(tinyfish.length, 1);
        assert.equal(tinyfish[0].description, 'TinyFish snippet');
        request = lastRequest();
        assert.equal(request.url, 'https://api.search.tinyfish.ai');
        assert.equal(request.method, 'get');
        assert.equal(request.headers.get('X-API-Key'), 'fixture-tinyfish');
        assert.deepEqual(request.params, { query });

        replies.set('https://google.serper.dev/search', {
            organic: [
                { title: sample.title, link: sample.url, snippet: 'Serper snippet', position: 1 },
                { title: 'Private address', link: 'http://10.0.0.1/private', snippet: 'not public', position: 2 }
            ]
        });
        const serper = await internationalSearchApis.serper(query, 500);
        assert.equal(serper.length, 1);
        assert.equal(serper[0].description, 'Serper snippet');
        request = lastRequest();
        assert.equal(request.url, 'https://google.serper.dev/search');
        assert.equal(request.method, 'post');
        assert.equal(request.headers.get('X-API-KEY'), 'fixture-serper');
        assert.deepEqual(JSON.parse(request.data as string), { q: query, num: 100 });

        replies.set('https://serpapi.com/search.json', {
            search_metadata: { status: 'Success' },
            organic_results: [{ title: sample.title, link: sample.url, snippet: 'SerpApi snippet', position: 1 }]
        });
        const serpapi = await internationalSearchApis.serpapi(query, 500);
        assert.equal(serpapi.length, 1);
        assert.equal(serpapi[0].description, 'SerpApi snippet');
        request = lastRequest();
        assert.equal(request.url, 'https://serpapi.com/search.json');
        assert.equal(request.method, 'get');
        assert.equal(request.headers.has('Authorization'), false);
        assert.deepEqual(request.params, {
            engine: 'google',
            q: query,
            num: 100,
            api_key: `fixture-${serpapi[0].engine}`
        });

        const emptyCases = [
            ['perplexity', 'https://api.perplexity.ai/search', { results: [] }],
            ['linkup', 'https://api.linkup.so/v1/search', { results: [] }],
            ['kagi', 'https://kagi.com/api/v1/search', { data: { search: [] } }],
            ['tinyfish', 'https://api.search.tinyfish.ai', { results: [] }],
            ['serper', 'https://google.serper.dev/search', { organic: [] }],
            ['serpapi', 'https://serpapi.com/search.json', { organic_results: [] }]
        ] as const;
        for (const [engine, url, payload] of emptyCases) {
            replies.set(url, payload);
            assert.deepEqual(await internationalSearchApis[engine](query, 5), []);
        }

        replies.set('https://kagi.com/api/v1/search', { data: {} });
        assert.deepEqual(await internationalSearchApis.kagi(query, 5), []);
        replies.set('https://google.serper.dev/search', {});
        assert.deepEqual(await internationalSearchApis.serper(query, 5), []);
        replies.set('https://serpapi.com/search.json', {});
        assert.deepEqual(await internationalSearchApis.serpapi(query, 5), []);

        replies.set('https://api.perplexity.ai/search', { results: 'invalid' });
        await assert.rejects(internationalSearchApis.perplexity(query, 5), /invalid search response/);
        replies.set('https://kagi.com/api/v1/search', { data: { search: {} } });
        await assert.rejects(internationalSearchApis.kagi(query, 5), /invalid search response/);
        replies.set('https://api.search.tinyfish.ai', []);
        await assert.rejects(internationalSearchApis.tinyfish(query, 5), /invalid search response/);
        replies.set('https://serpapi.com/search.json', {
            error: 'Invalid API key fixture-serpapi'
        });
        await assert.rejects(internationalSearchApis.serpapi(query, 5), error => {
            assert.match(String(error), /unsuccessful search response/);
            assert.doesNotMatch(String(error), /fixture-serpapi/);
            return true;
        });

        console.log('✓ Perplexity, Linkup, Kagi, TinyFish, Serper and SerpApi search APIs');
    } finally {
        axios.defaults.adapter = originalAdapter;
        keys.forEach((key, index) => {
            const value = previousKeys[index];
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        });
        if (previousSearchType === undefined) delete process.env.PERPLEXITY_SEARCH_TYPE;
        else process.env.PERPLEXITY_SEARCH_TYPE = previousSearchType;
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
