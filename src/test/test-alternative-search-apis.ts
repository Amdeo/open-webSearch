import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import axios, { type InternalAxiosRequestConfig } from 'axios';
import { config as appConfig } from '../config.js';
import { alternativeSearchApis } from '../engines/alternativeSearchApis.js';

const keys = ['TAVILY_API_KEY', 'FIRECRAWL_API_KEY', 'FIRECRAWL_SEARCH_CATEGORY', 'YDC_API_KEY', 'SEARXNG_URL', 'SEARXNG_API_KEY'] as const;
const previous = keys.map(key => process.env[key]);
const originalAdapter = axios.defaults.adapter;
const originalFetch = globalThis.fetch;
const originalProxy = { useProxy: appConfig.useProxy, proxyUrl: appConfig.proxyUrl };
const sample = { title: 'SQLite WAL', url: 'https://sqlite.org/wal.html', content: 'SQLite docs' };
const requests: InternalAxiosRequestConfig[] = [];
const query = 'SQLite WAL documentation';

async function main(): Promise<void> {
    try {
        for (const key of keys) delete process.env[key];
        appConfig.useProxy = false;
        axios.defaults.adapter = async config => {
            requests.push(config);
            const payload = config.url?.includes('firecrawl')
                ? { success: true, data: { web: [{ ...sample, description: sample.content }] } }
                : config.url?.includes('ydc-index')
                    ? { results: { web: [{ ...sample, snippets: [sample.content] }] } }
                    : { results: [sample, { ...sample, url: 'http://localhost/test' }] };
            return { config, status: 200, statusText: 'OK', headers: {}, data: payload };
        };

        const tavily = await alternativeSearchApis.tavily(query, 50);
        assert.equal(tavily.length, 1);
        assert.equal(tavily[0].description, sample.content);
        assert.equal(requests[0].headers.get('X-Tavily-Access-Mode'), 'keyless');
        assert.equal(requests[0].headers.has('Authorization'), false);
        assert.equal(JSON.parse(requests[0].data).max_results, 20);
        process.env['TAVILY_API_KEY'] = 'fixture-t';
        await alternativeSearchApis.tavily(query, 1);
        assert.equal(requests[1].headers.get('Authorization'), 'Bearer fixture-t');
        assert.equal(requests[1].headers.has('X-Tavily-Access-Mode'), false);

        const firecrawl = await alternativeSearchApis.firecrawl(query, 3);
        assert.equal(firecrawl[0].description, sample.content);
        assert.deepEqual(JSON.parse(requests[2].data), { query, limit: 3, sources: ['web'] });
        assert.equal(requests[2].headers.has('Authorization'), false);

        process.env['YDC_API_KEY'] = 'fixture-y';
        const you = await alternativeSearchApis['you.com'](query, 3);
        assert.equal(you[0].description, sample.content);
        assert.equal(requests[3].headers.get('X-API-Key'), 'fixture-y');
        assert.equal(requests[3].url, 'https://ydc-index.io/v1/search');
        delete process.env.YDC_API_KEY;
        globalThis.fetch = async (url, init) => {
            assert.equal(String(url), 'https://api.you.com/mcp/free');
            assert.equal(init?.redirect, 'error');
            if (init?.method !== 'POST') return new Response(null, { status: 405 });
            const body = JSON.parse(String(init.body));
            if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
            const result = body.method === 'initialize'
                ? { protocolVersion: body.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1.0.0' } }
                : { content: [], structuredContent: { results: { web: [{ ...sample, snippets: [sample.content] }] } } };
            if (body.method !== 'initialize') {
                assert.equal(body.method, 'tools/call');
                assert.deepEqual(body.params, { name: 'you-search', arguments: { query, count: 50 } });
            }
            return Response.json({ jsonrpc: '2.0', id: body.id, result });
        };
        assert.equal((await alternativeSearchApis['you.com'](query, 50))[0].url, sample.url);
        assert.equal(requests.length, 4);

        await assert.rejects(alternativeSearchApis.searxng(query, 1), /SEARXNG_URL/);
        const invalidUrl = new URL('http://localhost:8080/searx');
        invalidUrl.username = 'fixture-user';
        process.env.SEARXNG_URL = invalidUrl.href;
        await assert.rejects(alternativeSearchApis.searxng(query, 1), /SEARXNG_URL/);
        assert.equal(requests.length, 4);
        process.env.SEARXNG_URL = 'http://localhost:8080/searx/';
        process.env['SEARXNG_API_KEY'] = 'fixture-s';
        const searxng = await alternativeSearchApis.searxng(query, 1);
        assert.equal(searxng[0].url, sample.url);
        assert.equal(requests[4].url, 'http://localhost:8080/searx/search');
        assert.deepEqual(requests[4].params, { q: query, format: 'json' });
        assert.equal(requests[4].headers.get('Authorization'), 'Bearer fixture-s');
        assert.equal(requests[4].proxy, false);
        assert.equal(requests[4].maxRedirects, 0);
        process.env.FIRECRAWL_SEARCH_CATEGORY = 'developer';
        await alternativeSearchApis.firecrawl(query, 3);
        assert.deepEqual(JSON.parse(requests[5].data), { query, limit: 3, categories: ['developer'] });

        appConfig.useProxy = true;
        appConfig.proxyUrl = 'http://127.0.0.1:7890';
        globalThis.fetch = async () => { throw new Error('direct fetch should not run with USE_PROXY=true'); };
        let toolCalled = false;
        axios.defaults.adapter = async request => {
            assert.equal(request.url, 'https://api.you.com/mcp/free');
            assert.equal(request.httpsAgent?.constructor.name, 'HttpsProxyAgent');
            assert.equal(request.maxRedirects, 0);
            const body = JSON.parse(String(request.data));
            const result = body.method === 'initialize'
                ? { protocolVersion: body.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1.0.0' } }
                : { content: [], structuredContent: { results: { web: [sample] } } };
            toolCalled ||= body.method === 'tools/call';
            return {
                config: request,
                status: body.method === 'notifications/initialized' ? 202 : 200,
                statusText: 'OK',
                headers: { 'content-type': 'application/json' },
                data: Readable.from([Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }))])
            };
        };
        assert.equal((await alternativeSearchApis['you.com'](query, 3))[0].url, sample.url);
        assert.equal(toolCalled, true);
        console.log('✓ Tavily, Firecrawl, You.com and SearXNG search APIs');
    } finally {
        axios.defaults.adapter = originalAdapter;
        globalThis.fetch = originalFetch;
        Object.assign(appConfig, originalProxy);
        keys.forEach((key, index) => {
            const value = previous[index];
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        });
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
