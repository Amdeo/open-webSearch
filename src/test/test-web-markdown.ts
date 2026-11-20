import assert from 'node:assert/strict';
import { AxiosHeaders } from 'axios';
import { fetchWebContent, __setBrowserHtmlFetcherForTests } from '../engines/web/fetchWebContent.js';
import { __setAxiosRequestForTests } from '../utils/httpRequest.js';
import { __setDnsLookupForTests } from '../utils/urlSafety.js';

const url = 'https://example.com/manual/page';
const html = `<!doctype html><html><head><base href="../api/"></head><body>
<nav>Unrelated navigation</nav><main><h2>Request options</h2>
<p>This reference lists the parameters accepted when making a request. The table below gives the default value for each parameter.</p>
<ul><li>Check the timeout.</li></ul>
<table><caption>Defaults</caption><colgroup><col><col></colgroup><tr><th>Parameter</th><th>Default</th></tr><tr><td>timeout</td><td>30</td></tr></table>
<pre><code>// initialize<br>start();<div>  prepare();</div><div>run();</div></code></pre>
<pre><code class="language-js">if (ready) {
  run();
}</code></pre><a href="guide">Full guide</a></main></body></html>`;

__setDnsLookupForTests(async () => [{ address: '93.184.216.34' }]);
const nativeMarkdown = '# Native Markdown\n\n```html\n<html><body>Example</body></html>\n```';
__setAxiosRequestForTests(async config => ({
    config: { ...config, headers: new AxiosHeaders() }, status: 200, statusText: 'OK',
    headers: { 'content-type': config.url === url ? 'text/html' : 'text/markdown' },
    data: config.url === url ? html : nativeMarkdown
}));
__setBrowserHtmlFetcherForTests(async () => ({ html, finalUrl: url, title: '' }));
try {
    const options = { renderMode: 'request', format: 'markdown' } as const;
    const request = await fetchWebContent(url, 5000, options);
    assert.match(request.content, /^## Request options$/m);
    assert.match(request.content, /^[-*+] +Check the timeout\.$/m);
    assert.match(request.content, /\|\s*timeout\s*\|\s*30\s*\|/);
    assert.match(request.content, /Defaults\s+\| Parameter \| Default \|/);
    assert.match(request.content, /\/\/ initialize\nstart\(\);\n  prepare\(\);\nrun\(\);/);
    assert.match(request.content, /```[^\n]*\nif \(ready\) \{\n  run\(\);\n\}\n```/);
    assert.match(request.content, /\[Full guide\]\(https:\/\/example\.com\/api\/guide\)/);
    assert.doesNotMatch(request.content, /Unrelated navigation/);
    const browser = await fetchWebContent(url, 5000, { ...options, renderMode: 'browser' });
    assert.equal(browser.content, request.content);
    const plain = await fetchWebContent(url, 5000, { renderMode: 'request' });
    assert.doesNotMatch(plain.content, /^## |^```/m);
    const readable = await fetchWebContent(url, 5000, { ...options, readability: true });
    assert.equal(readable.readabilityApplied, true);
    assert.match(readable.content, /\|\s*timeout\s*\|\s*30\s*\|/);
    assert.match(readable.content, /\[Full guide\]\(https:\/\/example\.com\/api\/guide\)/);
    assert.equal((await fetchWebContent(url + '.md', 5000, options)).content, nativeMarkdown);
    assert.equal((await fetchWebContent(url + '/source', 5000, { ...options, readability: true })).content, nativeMarkdown);
    console.log('Markdown request and browser extraction passed');
} finally {
    __setDnsLookupForTests();
    __setAxiosRequestForTests();
    __setBrowserHtmlFetcherForTests();
}
