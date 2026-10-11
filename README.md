# dsh-novelai-tags

DSH 插件：把 [tags-select.astrabrew.cn](https://tags-select.astrabrew.cn) 的公开只读标签接口包成
DeepSeek Harness 的工具，让模型能查 NovelAI / Danbooru 绘图标签的中英释义。

接口契约见 https://tags-select.astrabrew.cn/llm.md 。站点公开、无需账号或 API Key，
数据来自互联网社区整理，**不是 NovelAI 官方服务**，也不提供成人法典。

## 提供的东西

| 名称 | 类型 | 作用 |
| --- | --- | --- |
| `novelai_tags_search` | 工具 | 单个概念中英互查。`source=local` 查本站词典（精确/别名优先、支持分页）；`source=danbooru` 走 Danbooru 公共语义池 |
| `novelai_tags_resolve` | 工具 | 一次把多个互不相关的概念分别查成标签再合并（「给这段描述配标签」用），只走本地词典，单个失败不影响其余 |
| `novelai-tags-search` | 技能 | 用法规范：短概念、拆概念、照抄 tag 拼写、区分精确命中与语义建议 |
| `novelai-tags` | 提示词段 | 一段精简的常驻用法说明（可用 `systemPrompt: false` 关掉） |

## 安装

三种渠道，任选其一。装完**重启 DSH**（profile 的 loader 树变化不由 HMR 覆盖）。

**① 从分发包（.tgz）安装** —— 推荐给收到 tarball 的人：

```bash
dsh plugin --profile desktop add ./dsh-novelai-tags-1.0.0.tgz
```

校验分发包完整性（先比对你的 sha256 与同目录 `.sha256` 文件是否一致）：

```bash
shasum -a 256 -c dsh-novelai-tags-1.0.0.tgz.sha256
```

**② 从源码目录安装**（本地开发）：

```bash
dsh plugin --profile desktop add /path/to/dsh-novelai-tags
```

也可以直接在 Web 侧边栏「插件」页里指向本目录。

**③ 从 npm 安装**（仅在该包已发布后可用）：

```bash
dsh plugin --profile desktop add dsh-novelai-tags
```

本插件零第三方依赖，只用 Node 内建的 `fetch` / `AbortSignal`，
因此**安装不需要访问任何 registry**，也不会有 peer 依赖冲突。

## 打包分发

```bash
npm pack                 # 产出 dsh-novelai-tags-<version>.tgz
npm run pack:check       # 把 tarball 当交付物验一遍
shasum -a 256 dsh-novelai-tags-<version>.tgz > dsh-novelai-tags-<version>.tgz.sha256
```

`npm run pack:check` 不是"看看有没有报错"，它做的是：

1. 解包 tarball，断言 7 个必需文件都在、`test/` `scripts/` `node_modules/` 没混进去；
2. 校验 `main` / `exports["."]` / `dsh.bundle.patch` 指向的文件在**包内**真实存在；
3. 扫描全包，确认没有打包机的绝对路径、用户名或凭据残留；
4. 用假的 `ctx` 加载**解包后的副本**（不是源码目录），注册工具、读出技能正文，并真跑一次网络查询。

第 4 步是关键：它证明 tarball 是自包含的，不会在别人机器上缺文件。

发布到 npm：

```bash
npm publish              # publishConfig.access=public 已设好
```

包内只含 `lib/`、`skills/`、`cordis.patch.yml` 与三份文档（共 8 个文件、约 14 KB），
由 `package.json` 的 `files` 白名单控制。

## 配置

`cordis.patch.yml` 里已给出默认值，全部可省略：

```yaml
- insert:
    - id: novelai-tags
      name: 'dsh-novelai-tags'
      config:
        origin: 'https://tags-select.astrabrew.cn'  # 换自建/镜像站点
        timeoutMs: 20000                            # 单次请求超时
        systemPrompt: true                          # 是否注入提示词段
```

## 设计取舍

- **只读、无凭据**：只用公开 GET 接口，不申请 Key、不写盘、不改远端状态。
- **本地优先**：默认 `source=local`，不消耗 Danbooru 的匿名共享额度，也就不会被限流。
- **限流不硬扛**：`source=danbooru` 遇到 429/503 直接报错并建议改用本地词典，不反复重试、
  不退回私有 Key、不抓取绕过。
- **不编造译名**：源数据 `zh` 为空时输出空串并附说明，绝不自造中文释义。
- **区分命中强度**：`exact` / `alias` 是词典精确命中，`prefix` / `contains` / `semantic` 只是相近建议，
  渲染文本里会分开标注。
- **权重语法自动清理**：`{{tag}}`、`[tag]`、`(tag:1.2)`、`tag::2::` 的外围权重会被剥掉，
  但 `misaka_mikoto_(toaru_majutsu_no_index)` 这类标签内部的括号原样保留。

## 自测

```bash
npm test                 # 等价于 node test/smoke.mjs
```

覆盖注册协议、参数清洗、错误路径、输出 schema 合规性（按 `dsh-tools` 的受支持子集自查），
以及三个真实网络查询。

## 出处与授权

本插件原创，MIT（见 `LICENSE`）。技能文本的主题与事实来自服务方公开发布的
[SKILL.md](https://tags-select.astrabrew.cn/skills/novelai-tags-search/SKILL.md) 与
[llm.txt](https://tags-select.astrabrew.cn/llm.txt)，为 DSH 场景重写而非逐字复制。
标签数据由第三方社区站点实时提供，**不是 NovelAI 官方服务**。详见 `PROVENANCE.md`。
