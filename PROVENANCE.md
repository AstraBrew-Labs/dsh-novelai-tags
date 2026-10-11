# PROVENANCE

本文件记录 `dsh-novelai-tags` 的内容来源，供分发时说明出处与授权。

## 代码

`lib/index.js`、`lib/api.js`、`test/smoke.mjs` 为本插件原创，MIT 授权（见 `LICENSE`）。
只使用 Node 内建能力（`fetch` / `AbortSignal` / `node:fs/promises` / `node:url`），
**没有任何第三方运行时依赖**，也不复制任何上游代码。

插件协议（`apply` / `inject` / `name` 导出、`ctx.tools.register` 的工具形状、
`ctx.systemPrompt.section` 的动态 section、`ctx.skills.registerProvider` 的 provider 形状）
依照 DeepSeek Harness 官方插件约定与 `@deepseek-ai/dsh-tool-web` 的写法实现。

## 技能文本

`skills/novelai-tags-search/SKILL.md` 的**主题与事实**（接口路径与参数、
`direction` / `source` 取值、`offset` 仅本地分页、`limit` 1–50、
Danbooru 走匿名共享池、429/503 时的处置、照抄 tag 拼写、不编造译名、
区分精确命中与语义建议）来自服务方公开发布的两份文档：

- <https://tags-select.astrabrew.cn/skills/novelai-tags-search/SKILL.md>
- <https://tags-select.astrabrew.cn/llm.txt>

本文件是**按 DSH 工具场景重新撰写的**，不是上游文本的逐字副本；
措辞、结构与面向 DSH 的补充（工具名、宿主无 skills 服务时的降级等）为本插件原创。

## 数据来源

标签数据由第三方社区站点 <https://tags-select.astrabrew.cn> 提供，
经其公开只读接口 `GET /api/ai/tags` 获取。

- 该站点**不是 NovelAI 官方服务**，也不隶属于本插件作者。
- 词典内容为互联网社区整理，准确性、完整性与可用性由该站点负责。
- 本插件不打包、不缓存、不再分发任何标签数据——每次查询都实时请求源站。
- 接口无需账号或 API Key；`source=danbooru` 使用该站点的匿名共享试用额度。
- 该站点只开放普通标签，不提供成人法典。

若上游站点变更接口或停止服务，本插件会失效；换用自建/镜像站点可改 `origin` 配置项
（见 `README.md`）。

## 商标

NovelAI、Danbooru、DeepSeek Harness 等名称归各自权利人所有，
本项目与它们均无隶属或背书关系。
