import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startLocalDaemon } from '../adapters/http/localDaemon.js';
import { createOpenWebSearchRuntime } from '../runtime/createRuntime.js';

async function main(): Promise<void> {
    const env = {
        MODE: 'http',
        MCP_HTTP_HOST: '127.0.0.1',
        PORT: '0',
        EXA_API_KEY: 'fixture',
        OPEN_WEBSEARCH_QUIET_STARTUP: 'true'
    };
    const refused = spawnSync(process.execPath, ['build/index.js'], { env, encoding: 'utf8', timeout: 4000 });
    assert.equal(refused.status, 1, 'HTTP-only mode with a provider Key and no caller token must exit before listening');
    assert.match(refused.stderr, /MCP_HTTP_AUTH_TOKEN/);

    const token = 'fixture-http-token';
    const child = spawn(process.execPath, ['build/index.js'], {
        env: { ...env, MCP_HTTP_AUTH_TOKEN: token },
        stdio: ['ignore', 'ignore', 'pipe']
    });
    const stopped = once(child, 'exit');
    const client = new Client({ name: 'auth-test', version: '1.0.0' });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const port = await Promise.race([
            new Promise<string>(resolve => {
                let output = '';
                child.stderr.on('data', chunk => {
                    output += String(chunk);
                    const match = /HTTP server running on port ([1-9]\d*)/.exec(output);
                    if (match) resolve(match[1]);
                });
            }),
            stopped.then(() => { throw new Error('HTTP MCP exited before listening'); }),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('HTTP MCP did not start')), 4000);
            })
        ]);
        const url = new URL(`http://127.0.0.1:${port}/mcp`);
        for (const headers of [{}, { Authorization: 'Bearer incorrect' }] as Record<string, string>[]) {
            const response = await fetch(url, { method: 'POST', headers, body: '{}' });
            assert.equal(response.status, 401);
            await response.body?.cancel();
        }
        await client.connect(new StreamableHTTPClientTransport(url, {
            requestInit: { headers: { Authorization: `Bearer ${token}` } }
        }), { timeout: 3000 });
        assert.ok((await client.listTools()).tools.some(tool => tool.name === 'search'));
        const result = await client.callTool({ name: 'search', arguments: { query: 'fixture', engines: ['brave-api'] } });
        assert.equal(result.isError, true);
        assert.ok(Array.isArray(result.content));
        const content = result.content[0];
        assert.ok(content.type === 'text');
        const failure = JSON.parse(content.text);
        assert.equal(failure.code, 'all_engines_failed');
        assert.equal(failure.partialFailures[0].code, 'missing_api_key');
    } finally {
        clearTimeout(timer);
        await client.close();
        child.kill();
        await stopped;
    }
    console.log('✓ HTTP MCP requires caller authentication when provider credentials are configured');

    const runtime = createOpenWebSearchRuntime({
        dependencies: { searchExecutors: { bing: async () => { throw new Error('Fixture engine failed'); } } }
    });
    const previous = process.env.EXA_API_KEY;
    process.env.EXA_API_KEY = 'fixture';
    try {
        await assert.rejects(startLocalDaemon(runtime, { host: '192.0.2.1', port: 0 }), /must listen on 127\.0\.0\.1 or ::1/);
    } finally {
        if (previous === undefined) delete process.env.EXA_API_KEY;
        else process.env.EXA_API_KEY = previous;
    }
    const daemon = await startLocalDaemon(runtime, { port: 0 });
    try {
        const response = await fetch(new URL('/search', daemon.baseUrl), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: 'fixture', engines: ['bing'] })
        });
        assert.equal(response.status, 502);
        const body = await response.json();
        assert.equal(body.error.code, 'all_engines_failed');
        assert.equal(body.error.details.partialFailures[0].engine, 'bing');
    } finally {
        await daemon.close();
    }

    const cli = spawnSync(process.execPath, ['build/index.js', 'search', 'fixture', '--engine', 'brave-api', '--json'], {
        env: { ...env, OPEN_WEBSEARCH_DAEMON_PORT: '0' },
        encoding: 'utf8',
        timeout: 4000
    });
    assert.equal(cli.status, 1);
    const result = JSON.parse(cli.stdout);
    assert.equal(result.error.code, 'all_engines_failed');
    assert.equal(result.error.details.partialFailures[0].code, 'missing_api_key');
    console.log('✓ Search failures are exposed through MCP, HTTP daemon and CLI');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
