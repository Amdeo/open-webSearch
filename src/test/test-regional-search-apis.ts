import assert from 'node:assert/strict';
import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { regionalSearchApis } from '../engines/regionalSearchApis.js';

const DEEPSEEK_SEARCH_URL = 'https://api.deepseek.com/v1/tools/search';
const DOUBAO_SEARCH_URL = 'https://open.feedcoopapi.com/search_api/web_search';
const YUANBAO_SEARCH_URL = 'https://api.wsa.cloud.tencent.com/SearchPro';
const ZHIPU_SEARCH_URL = 'https://open.bigmodel.cn/api/paas/v4/web_search';
const BAIDU_SEARCH_URL = 'https://qianfan.baidubce.com/v2/ai_search/web_search';
const BOCHA_SEARCH_URL = 'https://api.bochaai.com/v1/web-search';
const ALIYUN_IQS_SEARCH_URL = 'https://cloud-iqs.aliyuncs.com/search/unified';

const ENV_KEYS = [
    'DEEPSEEK_API_KEY',
    'DOUBAO_SEARCH_API_KEY',
    'YUANBAO_SEARCH_API_KEY',
    'ZHIPUAI_API_KEY',
    'QIANFAN_API_KEY',
    'BOCHA_API_KEY',
    'ALIYUN_IQS_API_KEY'
] as const;

const fixtureKeys: Record<(typeof ENV_KEYS)[number], string> = {
    DEEPSEEK_API_KEY: `fixture-${'deepseek'}`,
    DOUBAO_SEARCH_API_KEY: `fixture-${'doubao'}`,
    YUANBAO_SEARCH_API_KEY: `fixture-${'yuanbao'}`,
    ZHIPUAI_API_KEY: `fixture-${'zhipu'}`,
    QIANFAN_API_KEY: `fixture-${'qianfan'}`,
    BOCHA_API_KEY: `fixture-${'bocha'}`,
    ALIYUN_IQS_API_KEY: `fixture-${'aliyun'}`
};

async function main(): Promise<void> {
    const originalAdapter = axios.defaults.adapter;
    const originalEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
    const originalZhipuEngine = process.env.ZHIPU_SEARCH_ENGINE;
    const originalYuanbaoSpeed = process.env.YUANBAO_SEARCH_SPEED;
    const publicUrl = 'https://example.com/regional-search';
    const privateUrl = 'http://127.0.0.1/';
    const requests: InternalAxiosRequestConfig[] = [];
    let responseForUrl: (url: string) => unknown = () => {
        throw new Error('测试尚未配置上游响应');
    };

    const bodyOf = (request: InternalAxiosRequestConfig): Record<string, unknown> =>
        JSON.parse(String(request.data)) as Record<string, unknown>;

    try {
        axios.defaults.adapter = async request => {
            requests.push(request);
            return {
                data: responseForUrl(request.url ?? ''),
                status: 200,
                statusText: 'OK',
                headers: {},
                config: request
            };
        };

        // 缺少 Key 时不得发起请求。
        delete process.env.ZHIPU_SEARCH_ENGINE;
        delete process.env.YUANBAO_SEARCH_SPEED;
        for (const key of ENV_KEYS) delete process.env[key];
        for (const executor of Object.values(regionalSearchApis)) {
            const error = await executor('测试查询', 5).catch((caught: unknown) => caught);
            assert.ok(error !== null && typeof error === 'object' && 'code' in error);
            assert.equal(error.code, 'missing_api_key');
        }
        assert.equal(requests.length, 0);

        for (const key of ENV_KEYS) process.env[key] = fixtureKeys[key];
        process.env.ZHIPU_SEARCH_ENGINE = 'sogou';

        responseForUrl = url => {
            switch (url) {
                case DEEPSEEK_SEARCH_URL:
                    return { results: [
                        { title: 'DeepSeek 结果', url: publicUrl, snippet: '短摘要', summary: '长摘要' },
                        { title: '内网结果', url: privateUrl, summary: '应被丢弃' },
                        { title: '缺少链接', summary: '应被丢弃' }
                    ] };
                case DOUBAO_SEARCH_URL:
                    return {
                        ResponseMetadata: { RequestId: 'fixture' },
                        Result: { WebResults: [
                            { Title: '豆包结果', Url: publicUrl, Snippet: '豆包片段', Summary: '豆包摘要' },
                            { Title: '如意卡片', Summary: '没有链接' }
                        ] }
                    };
                case YUANBAO_SEARCH_URL:
                    return { Response: { Pages: [
                        JSON.stringify({ title: '元宝结果', url: publicUrl, passage: '元宝摘要' }),
                        'not-json',
                        JSON.stringify({ title: '缺少链接' }),
                        JSON.stringify({ title: '内网结果', url: privateUrl }),
                        JSON.stringify({ title: '腾讯结果', url: 'https://news.qq.com/rain/a/fixture', passage: '腾讯摘要' })
                    ] } };
                case ZHIPU_SEARCH_URL:
                    return { search_result: [
                        { title: '智谱结果', link: publicUrl, content: '智谱摘要', media: '示例' },
                        { title: '内网结果', link: privateUrl, content: '应被丢弃' }
                    ] };
                case BAIDU_SEARCH_URL:
                    return { request_id: 'fixture', references: [
                        { id: 1, type: 'web', title: '千帆结果', url: publicUrl, snippet: '千帆摘要' },
                        { id: 2, type: 'aladdin', title: '阿拉丁', url: 'https://example.com/aladdin' },
                        { id: 3, type: 'web', title: '内网结果', url: privateUrl, snippet: '应被丢弃' }
                    ] };
                case BOCHA_SEARCH_URL:
                    return { code: 200, data: { webPages: { value: [
                        { name: '博查结果', url: publicUrl, summary: '博查摘要', snippet: '博查片段' },
                        { name: '内网结果', url: privateUrl, summary: '应被丢弃' }
                    ] } } };
                case ALIYUN_IQS_SEARCH_URL:
                    return { requestId: 'fixture', pageItems: [
                        { title: 'IQS 结果', link: publicUrl, snippet: 'IQS 摘要' },
                        { title: '内网结果', link: privateUrl, snippet: '应被丢弃' }
                    ] };
                default:
                    throw new Error(`未预期的 URL: ${url}`);
            }
        };

        await assert.rejects(regionalSearchApis.deepseek('深'.repeat(129), 12), { code: 'query_too_long' });
        await assert.rejects(regionalSearchApis.doubao('豆'.repeat(101), 1), { code: 'query_too_long' });
        await assert.rejects(regionalSearchApis.zhipu('智'.repeat(71), 1), { code: 'query_too_long' });
        await assert.rejects(regionalSearchApis['baidu-api']('北'.repeat(37), 1), { code: 'query_too_long' });
        await assert.rejects(regionalSearchApis['aliyun-iqs']('阿'.repeat(501), 1), { code: 'query_too_long' });
        assert.equal(requests.length, 0);

        const deepseek = await regionalSearchApis.deepseek('深'.repeat(128), 12);
        assert.deepEqual(deepseek.map(item => [item.url, item.title, item.description, item.engine]), [
            [publicUrl, 'DeepSeek 结果', '长摘要', 'deepseek']
        ]);

        const doubao = await regionalSearchApis.doubao('豆'.repeat(100), 80);
        assert.deepEqual(doubao.map(item => [item.url, item.title, item.description, item.engine]), [
            [publicUrl, '豆包结果', '豆包摘要', 'doubao']
        ]);

        const yuanbao = await regionalSearchApis.yuanbao('元宝', 25);
        assert.deepEqual(yuanbao.map(item => [item.url, item.title, item.description, item.engine]), [
            [publicUrl, '元宝结果', '元宝摘要', 'yuanbao'],
            ['https://news.qq.com/rain/a/fixture', '腾讯结果', '腾讯摘要', 'yuanbao']
        ]);

        const zhipu = await regionalSearchApis.zhipu('智'.repeat(70), 25);
        assert.deepEqual(zhipu.map(item => [item.url, item.title, item.description, item.engine]), [
            [publicUrl, '智谱结果', '智谱摘要', 'zhipu']
        ]);

        process.env.ZHIPU_SEARCH_ENGINE = 'std';
        const zhipuStd = await regionalSearchApis.zhipu('智谱', 12);
        assert.deepEqual(zhipuStd.map(item => [item.url, item.title, item.description, item.engine]), [
            [publicUrl, '智谱结果', '智谱摘要', 'zhipu']
        ]);

        process.env.ZHIPU_SEARCH_ENGINE = 'unsupported';
        const zhipuConfigError = await regionalSearchApis.zhipu('智谱', 5).catch((caught: unknown) => caught);
        assert.ok(zhipuConfigError instanceof Error);
        assert.match(zhipuConfigError.message, /ZHIPU_SEARCH_ENGINE/);
        process.env.ZHIPU_SEARCH_ENGINE = 'std';

        const baidu = await regionalSearchApis['baidu-api']('北'.repeat(36), 10);
        assert.deepEqual(baidu.map(item => [item.url, item.title, item.description, item.engine]), [
            [publicUrl, '千帆结果', '千帆摘要', 'baidu-api']
        ]);

        const bocha = await regionalSearchApis.bocha('博查', 60);
        assert.deepEqual(bocha.map(item => [item.url, item.title, item.description, item.engine]), [
            [publicUrl, '博查结果', '博查摘要', 'bocha']
        ]);

        const aliyun = await regionalSearchApis['aliyun-iqs']('阿里', 20);
        assert.deepEqual(aliyun.map(item => [item.url, item.title, item.description, item.engine]), [
            [publicUrl, 'IQS 结果', 'IQS 摘要', 'aliyun-iqs']
        ]);

        assert.equal(requests.length, 8);
        assert.deepEqual(requests.map(request => request.url), [
            DEEPSEEK_SEARCH_URL,
            DOUBAO_SEARCH_URL,
            YUANBAO_SEARCH_URL,
            ZHIPU_SEARCH_URL,
            ZHIPU_SEARCH_URL,
            BAIDU_SEARCH_URL,
            BOCHA_SEARCH_URL,
            ALIYUN_IQS_SEARCH_URL
        ]);
        assert.deepEqual(requests.map(request => request.headers.get('Authorization')), [
            'Bearer fixture-deepseek',
            'Bearer fixture-doubao',
            'Bearer fixture-yuanbao',
            'Bearer fixture-zhipu',
            'Bearer fixture-zhipu',
            'Bearer fixture-qianfan',
            'Bearer fixture-bocha',
            'Bearer fixture-aliyun'
        ]);
        assert.ok(requests.every(request => request.method === 'post'));
        assert.ok(requests.every(request => request.maxRedirects === 0 && request.proxy === false));

        const deepseekBody = bodyOf(requests[0]);
        assert.equal(deepseekBody.query, '深'.repeat(128));
        assert.equal(deepseekBody.count, 12);
        assert.equal(deepseekBody.need_content, false);

        const doubaoBody = bodyOf(requests[1]);
        assert.equal(doubaoBody.Query, '豆'.repeat(100));
        assert.equal(doubaoBody.Count, 50);
        assert.equal(doubaoBody.SearchType, 'web');
        assert.deepEqual(doubaoBody.Filter, { NeedUrl: true });

        const yuanbaoBody = bodyOf(requests[2]);
        assert.equal(yuanbaoBody.Query, '元宝');
        assert.equal(yuanbaoBody.Cnt, 30);

        const sogouBody = bodyOf(requests[3]);
        assert.equal(sogouBody.search_query, '智'.repeat(70));
        assert.equal(sogouBody.search_engine, 'search_pro_sogou');
        assert.equal(sogouBody.count, 30);
        assert.equal(sogouBody.search_intent, false);

        const stdBody = bodyOf(requests[4]);
        assert.equal(stdBody.search_engine, 'search_std');
        assert.equal(stdBody.count, 12);

        const baiduBody = bodyOf(requests[5]);
        const messages: unknown = baiduBody.messages;
        assert.ok(Array.isArray(messages));
        const message: unknown = messages[0];
        assert.ok(typeof message === 'object' && message !== null && 'role' in message && 'content' in message);
        assert.equal(message.role, 'user');
        assert.equal(message.content, '北'.repeat(36));
        assert.equal(baiduBody.search_source, 'baidu_search_v2');
        assert.deepEqual(baiduBody.resource_type_filter, [{ type: 'web', top_k: 10 }]);
        assert.equal(baiduBody.edition, 'standard');

        const bochaBody = bodyOf(requests[6]);
        assert.equal(bochaBody.query, '博查');
        assert.equal(bochaBody.summary, true);
        assert.equal(bochaBody.count, 50);

        const aliyunBody = bodyOf(requests[7]);
        assert.equal(aliyunBody.query, '阿里');
        assert.equal(aliyunBody.engineType, 'CNLiteBasic');
        assert.deepEqual(aliyunBody.advancedParams, { numResults: '20' });
        assert.deepEqual(aliyunBody.contents, {
            mainText: false,
            markdownText: false,
            summary: false,
            rerankScore: true
        });

        process.env.YUANBAO_SEARCH_SPEED = 'true';
        await regionalSearchApis.yuanbao('元宝极速版', 5);
        assert.deepEqual(bodyOf(requests[8]), { Query: '元宝极速版' });
        process.env.ZHIPU_SEARCH_ENGINE = 'quark';
        await regionalSearchApis.zhipu('智谱夸克', 5);
        assert.equal(bodyOf(requests[9]).search_engine, 'search_pro_quark');
        assert.equal('count' in bodyOf(requests[9]), false);
        delete process.env.YUANBAO_SEARCH_SPEED;
        delete process.env.ZHIPU_SEARCH_ENGINE;

        // 正常空结果必须保持为空数组，不能当作服务错误。
        requests.length = 0;
        responseForUrl = url => {
            switch (url) {
                case DEEPSEEK_SEARCH_URL:
                    return { results: [] };
                case DOUBAO_SEARCH_URL:
                    return { ResponseMetadata: {}, Result: { WebResults: [] } };
                case YUANBAO_SEARCH_URL:
                    return { Response: { Pages: [] } };
                case ZHIPU_SEARCH_URL:
                    return { search_result: [] };
                case BAIDU_SEARCH_URL:
                    return { request_id: 'fixture', references: [] };
                case BOCHA_SEARCH_URL:
                    return { code: 200, data: { webPages: { value: [] } } };
                case ALIYUN_IQS_SEARCH_URL:
                    return { requestId: 'fixture', pageItems: [] };
                default:
                    throw new Error(`未预期的 URL: ${url}`);
            }
        };
        for (const executor of Object.values(regionalSearchApis)) {
            assert.deepEqual(await executor('空结果', 5), []);
        }
        assert.equal(requests.length, 7);

        // HTTP 200 内的服务错误包装必须转成通用消息，且不得回显上游正文。
        requests.length = 0;
        const errorBodies: Record<string, unknown> = {
            [DEEPSEEK_SEARCH_URL]: { error: { message: 'fixture-secret 上游错误' } },
            [DOUBAO_SEARCH_URL]: {
                ResponseMetadata: { Error: { Code: '10400', Message: 'fixture-secret 上游错误' } },
                Result: null
            },
            [YUANBAO_SEARCH_URL]: {
                Response: { Error: { Code: 'UnauthorizedOperation', Message: 'fixture-secret 上游错误' }, Pages: [] }
            },
            [ZHIPU_SEARCH_URL]: { error: { code: '1001', message: 'fixture-secret 上游错误' } },
            [BAIDU_SEARCH_URL]: { requestId: 'fixture', code: 216003, message: 'fixture-secret 上游错误' },
            [BOCHA_SEARCH_URL]: { code: 403, message: 'fixture-secret 上游错误' },
            [ALIYUN_IQS_SEARCH_URL]: { requestId: 'fixture', code: 'Retrieval.NotActivated', message: 'fixture-secret 上游错误' }
        };
        responseForUrl = url => {
            const body = errorBodies[url];
            if (!body) throw new Error(`未预期的 URL: ${url}`);
            return body;
        };
        for (const executor of Object.values(regionalSearchApis)) {
            const error = await executor('错误', 5).catch((caught: unknown) => caught);
            assert.ok(error instanceof Error);
            assert.match(error.message, /搜索服务返回错误/);
            assert.ok(!error.message.includes('fixture-secret'));
        }
        assert.equal(requests.length, 7);

        // Axios 层的错误只暴露状态码，不能带出 Key 或响应正文。
        axios.defaults.adapter = async request => {
            const response = {
                data: 'fixture-deepseek 上游错误',
                status: 429,
                statusText: 'Too Many Requests',
                headers: {},
                config: request
            };
            throw new AxiosError('上游回显 fixture-deepseek', AxiosError.ERR_BAD_REQUEST, request, undefined, response);
        };
        const httpError = await regionalSearchApis.deepseek('限流', 5).catch((caught: unknown) => caught);
        assert.ok(httpError instanceof Error);
        assert.equal(httpError.message, 'deepseek returned HTTP 429');
        assert.ok(!httpError.message.includes('fixture-deepseek'));

        console.log('✓ 区域搜索 API 的鉴权、请求载荷、结果解析与安全失败');
    } finally {
        axios.defaults.adapter = originalAdapter;
        for (const key of ENV_KEYS) {
            const value = originalEnv[key];
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        if (originalZhipuEngine === undefined) delete process.env.ZHIPU_SEARCH_ENGINE;
        else process.env.ZHIPU_SEARCH_ENGINE = originalZhipuEngine;
        if (originalYuanbaoSpeed === undefined) delete process.env.YUANBAO_SEARCH_SPEED;
        else process.env.YUANBAO_SEARCH_SPEED = originalYuanbaoSpeed;
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
