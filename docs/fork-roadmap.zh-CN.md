# open-webSearch 二开功能清单

开发起点为上游 [main · 2562c92](https://github.com/Aas-ee/open-webSearch/tree/2562c9233a945c18fa9d08b7e450ca218a8853b6)。下列各项均为计划。

## 第一版 · 读取技术文档

- [ ] **可选的 Markdown 正文。** 通用抓取工具增加 `format` 选项，默认 `text`，显式选择 `markdown` 时把 HTML 正文转成 Markdown。普通请求和浏览器渲染取得的 HTML 共用转换逻辑。MCP、CLI 和 HTTP 都能选择格式。
- [ ] **保留文档结构。** 保留标题层级、列表、代码块的换行和缩进、普通表格的行列关系，以及正文链接的目标。相对链接按页面有效基地址解析。原生 Markdown 响应沿用现有读取路径。

验收用一份带参数表、缩进代码和相对链接的固定 HTML 样例。逐项核对参数与默认值、代码缩进和链接地址。相同 HTML 通过普通请求和浏览器渲染进入时应得到相同正文。不传 `format` 的已有调用继续通过原测试。

## 第二版 · 合并多个引擎的结果

- [ ] **交错取结果并按 URL 去重。** 各引擎先取候选，再按每路第 1 条、第 2 条的顺序轮流取。对合并后的唯一链接应用总条数上限，保留有意义的查询参数和章节锚点。
- [ ] **标记命中来源并补足条数。** 同一链接列出命中的所有引擎。一路返回空结果或出现普通请求错误时，从其他成功引擎已有的候选中补足，并保留上游已有的 `partialFailures`。

验收示例：A 返回 `[甲, 乙]`，B 返回 `[甲, 丙]`，上限为 3，结果应为 `[甲, 乙, 丙]`，甲标记 A、B。再让 A 超时、B 返回 3 个不同链接，仍应拿到 3 条，并能看到 A 的错误。

## 候选 · 长文档续读与查找

- [ ] **在同一份正文内继续读取或定位关键词。** 首次返回预览，确有需要时再读取后文。候选方案使用有期限的文档标识，支持远程客户端，无需共享服务器文件路径。

验收示例：关键词只在预览之后出现，第二次调用能找到它并返回上下文。两次操作合计只下载网页一次。标识过期后给出明确提示。

上游已提供 Exa、Playwright、原生 Markdown 文件读取和部分引擎失败报告，可直接复用。[上游说明](https://github.com/Aas-ee/open-webSearch/blob/2562c9233a945c18fa9d08b7e450ca218a8853b6/README.md) · [网页提取实现](https://github.com/Aas-ee/open-webSearch/blob/2562c9233a945c18fa9d08b7e450ca218a8853b6/src/engines/web/fetchWebContent.ts) · [搜索合并实现](https://github.com/Aas-ee/open-webSearch/blob/2562c9233a945c18fa9d08b7e450ca218a8853b6/src/core/search/searchService.ts)
