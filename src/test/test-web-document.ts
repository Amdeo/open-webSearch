import assert from 'node:assert/strict';
import { AxiosHeaders } from 'axios';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createOpenWebSearchRuntime } from '../runtime/createRuntime.js';
import { setupTools } from '../tools/setupTools.js';
import { __setAxiosRequestForTests } from '../utils/httpRequest.js';
import { __setDnsLookupForTests } from '../utils/urlSafety.js';
import { __setReadabilityParserForTests } from '../engines/web/fetchWebContent.js';
import { saveWebDocument, readWebDocument } from '../core/fetch/webDocuments.js';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const fullText = `${'a'.repeat(1200)} needle ${'b'.repeat(1800)}`;
let downloads = 0;
__setDnsLookupForTests(async () => [{ address: '93.184.216.34' }]);
__setAxiosRequestForTests(async config => {
    if (config.method?.toUpperCase() === 'GET') downloads++;
    return { config: { ...config, headers: new AxiosHeaders() }, status: 200, statusText: 'OK',
        headers: { 'content-type': String(config.url).includes('/readable') ? 'text/html' : 'text/plain' }, data: fullText };
});
__setReadabilityParserForTests(async (_html, url) => ({
    content: url.endsWith('/readable-small') ? '<p>short HTML</p>' : url.endsWith('/readable-links')
        ? `<p>short text</p>${Array.from({ length: 100 }, (_, i) => `<a href="https://example.com/${i}">${'link'.repeat(40)}${i}</a>`).join('')}`
        : url.endsWith('/readable-few-links') ? '<a href="https://example.com/a">A</a><a href="https://example.com/b">B</a>'
        : url.endsWith('/readable-huge-link') ? `<a href="https://example.com/a">${'a'.repeat(11000)}</a>`
        : url.endsWith('/readable-large-html') ? `<p>${'x'.repeat(1500)}</p>` : `<p>${fullText}</p>`,
    textContent: url.endsWith('/readable-large-html') || url.endsWith('/readable-links') ? 'short text' : fullText
}));
const runtime = createOpenWebSearchRuntime();
async function connect() {
    const server = new McpServer({ name: 'test', version: '1' });
    setupTools(server, runtime);
    const client = new Client({ name: 'test', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return { client, server };
}
function payload(result: any): any { return JSON.parse(result.content[0].text); }
const originalNow = Date.now;
const a = await connect();
const b = await connect();
try {
    const fetch = payload(await a.client.callTool({ name: 'fetchWebContent', arguments: {
        url: 'https://example.com/doc', maxChars: 1000, renderMode: 'request'
    } }));
    assert.equal(fetch.truncated, true);
    assert.match(fetch.documentId, /^[a-f0-9]{64}$/);
    assert.equal(fetch.nextOffset, 1000);
    const page = payload(await a.client.callTool({ name: fetch.readTool, arguments: { documentId: fetch.documentId, offset: fetch.nextOffset, maxChars: 300 } }));
    assert.equal(page.content, fullText.slice(1000, 1300));
    assert.equal(page.nextOffset, 1300);
    const found = payload(await a.client.callTool({ name: fetch.readTool, arguments: { documentId: fetch.documentId, keyword: 'needle', maxChars: 100 } }));
    assert.equal(found.matchOffset, 1201);
    assert.match(found.content, /needle/);
    assert.equal(downloads, 1);
    const readable = payload(await a.client.callTool({ name: 'fetchWebContent', arguments: { url: 'https://example.com/readable', maxChars: 1000, renderMode: 'request', readability: true } }));
    assert.equal(readable.readableHtml, undefined);
    assert.equal(readable.readableHtmlOmitted, true);
    assert.equal(payload(await a.client.callTool({ name: readable.readTool, arguments: { documentId: readable.documentId, offset: 1000, maxChars: 100 } })).content, fullText.slice(1000, 1100));
    const smallHtml = payload(await a.client.callTool({ name: 'fetchWebContent', arguments: { url: 'https://example.com/readable-small', maxChars: 1000, renderMode: 'request', readability: true } }));
    assert.equal(smallHtml.readableHtml, '<p>short HTML</p>');
    assert.equal(smallHtml.readableHtmlOmitted, undefined);
    const whole = payload(await a.client.callTool({ name: 'fetchWebContent', arguments: { url: 'https://example.com/readable', maxChars: 5000, renderMode: 'request', readability: true } }));
    assert.equal(whole.truncated, false);
    assert.equal(whole.readableHtml, `<p>${fullText}</p>`);
    const largeHtml = payload(await a.client.callTool({ name: 'fetchWebContent', arguments: { url: 'https://example.com/readable-large-html', maxChars: 1000, renderMode: 'request', readability: true } }));
    assert.equal(largeHtml.truncated, false);
    assert.equal(largeHtml.readableHtml, undefined);
    assert.equal(largeHtml.readableHtmlOmitted, true);
    const manyLinks = payload(await a.client.callTool({ name: 'fetchWebContent', arguments: { url: 'https://example.com/readable-links', maxChars: 1000, renderMode: 'request', readability: true, includeLinks: true } }));
    assert.equal(manyLinks.linksTotal, 100);
    assert.equal(manyLinks.linksTruncated, true);
    assert(manyLinks.links.length > 0 && manyLinks.links.length < 100);
    assert(JSON.stringify(manyLinks.links).length <= 10000);
    assert.deepEqual(manyLinks.links[0], { text: `${'link'.repeat(40)}0`, href: 'https://example.com/0' });
    const fewLinks = payload(await a.client.callTool({ name: 'fetchWebContent', arguments: { url: 'https://example.com/readable-few-links', maxChars: 1000, renderMode: 'request', readability: true, includeLinks: true } }));
    assert.deepEqual(fewLinks.links, [{ text: 'A', href: 'https://example.com/a' }, { text: 'B', href: 'https://example.com/b' }]);
    assert.equal(fewLinks.linksTruncated, undefined);
    const hugeLink = payload(await a.client.callTool({ name: 'fetchWebContent', arguments: { url: 'https://example.com/readable-huge-link', maxChars: 1000, renderMode: 'request', readability: true, includeLinks: true } }));
    assert.deepEqual(hugeLink.links, []);
    assert.equal(hugeLink.linksTotal, 1);
    assert.equal(hugeLink.linksTruncated, true);
    const missing = payload(await a.client.callTool({ name: fetch.readTool, arguments: { documentId: fetch.documentId, keyword: 'missing' } }));
    assert.equal(missing.found, false);
    const tooLarge = await a.client.callTool({ name: fetch.readTool, arguments: { documentId: fetch.documentId, maxChars: 10001 } });
    assert.equal(tooLarge.isError, true);
    const pathRead = await a.client.callTool({ name: fetch.readTool, arguments: { documentId: '/tmp/document' } });
    assert.equal(pathRead.isError, true);
    const foreign = await b.client.callTool({ name: fetch.readTool, arguments: { documentId: fetch.documentId } });
    assert.equal(foreign.isError, true);
    Date.now = () => originalNow() + 31 * 60 * 1000;
    const expired = await a.client.callTool({ name: fetch.readTool, arguments: { documentId: fetch.documentId } });
    assert.equal(expired.isError, true);
    assert.match((expired.content as any)[0].text, /expired/i);
    Date.now = originalNow;
    const owner = Symbol();
    const first = saveWebDocument(owner, 'a'.repeat(140000))!;
    for (let i = 0; i < 60; i++) saveWebDocument(owner, 'b'.repeat(140000));
    assert.throws(() => readWebDocument(owner, first, 0, 100), /evicted/i);
    assert.equal(saveWebDocument(owner, 'x'.repeat(9 * 1024 * 1024)), undefined);
    const originalName = process.env.MCP_TOOL_SEARCH_NAME;
    const originalFetch = process.env.MCP_TOOL_FETCH_WEB_NAME;
    try {
        process.env.MCP_TOOL_SEARCH_NAME = 'readWebDocument';
        const collision = await connect();
        const tools = await collision.client.listTools();
        assert(tools.tools.some(tool => tool.name === 'readWebDocument_2'));
        const renamed = payload(await collision.client.callTool({ name: 'fetchWebContent', arguments: { url: 'https://example.com/doc', maxChars: 1000, renderMode: 'request' } }));
        assert.equal(renamed.readTool, 'readWebDocument_2');
        await collision.client.close(); await collision.server.close();
        process.env.MCP_TOOL_FETCH_WEB_NAME = '<disabled>';
        const disabled = await connect();
        assert(!(await disabled.client.listTools()).tools.some(tool => tool.name === 'readWebDocument_2'));
        await disabled.client.close(); await disabled.server.close();
    } finally {
        if (originalName === undefined) delete process.env.MCP_TOOL_SEARCH_NAME; else process.env.MCP_TOOL_SEARCH_NAME = originalName;
        if (originalFetch === undefined) delete process.env.MCP_TOOL_FETCH_WEB_NAME; else process.env.MCP_TOOL_FETCH_WEB_NAME = originalFetch;
    }
    const preload = `
        import { __setDnsLookupForTests } from ${JSON.stringify(pathToFileURL(path.resolve('build/utils/urlSafety.js')).href)};
        import { __setAxiosRequestForTests } from ${JSON.stringify(pathToFileURL(path.resolve('build/utils/httpRequest.js')).href)};
        __setDnsLookupForTests(async () => [{ address: '93.184.216.34' }]);
        __setAxiosRequestForTests(async config => ({ config, status: 200, statusText: 'OK', headers: { 'content-type': 'text/plain' }, data: 'z'.repeat(2000) }));
    `;
    const production = new Client({ name: 'production-test', version: '1' });
    const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, 'build/index.js'], env: { ...process.env as Record<string, string>, MODE: 'stdio' }, stderr: 'pipe' });
    await production.connect(transport);
    try {
        const fetched = payload(await production.callTool({ name: 'fetchWebContent', arguments: { url: 'https://example.com/doc', maxChars: 1000, renderMode: 'request' } }));
        const continued = payload(await production.callTool({ name: fetched.readTool, arguments: { documentId: fetched.documentId, offset: fetched.nextOffset, maxChars: 100 } }));
        assert.equal(continued.content, 'z'.repeat(100));
    } finally { await production.close(); }
    console.log('MCP document continuation, search, isolation and expiry passed');
} finally {
    Date.now = originalNow;
    await a.client.close(); await b.client.close();
    await a.server.close(); await b.server.close();
    __setDnsLookupForTests(); __setAxiosRequestForTests(); __setReadabilityParserForTests();
}
