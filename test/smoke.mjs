/**
 * 本地自测：不经过 DSH 宿主，直接用假的 ctx 装载插件，校验参数清洗、错误处理与渲染。
 * 运行：node test/smoke.mjs
 */
import { apply } from "../lib/index.js";
import { cleanQuery } from "../lib/api.js";

const tools = new Map();
let promptSection = null;
let skillProvider = null;

const ctx = {
  tools: {
    register(definition) {
      if (tools.has(definition.name)) throw new Error(`duplicate tool ${definition.name}`);
      tools.set(definition.name, definition);
    }
  },
  systemPrompt: {
    section(section) {
      promptSection = section;
    }
  },
  inject(_names, cb) {
    cb({ skills: { registerProvider(provider) { skillProvider = provider; } } });
  }
};

apply(ctx, {});

const failures = [];
function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures.push(`${label}${detail === void 0 ? "" : ` — ${detail}`}`);
    console.log(`  FAIL ${label}${detail === void 0 ? "" : ` — ${detail}`}`);
  }
}

console.log("注册结果");
check("注册了 2 个工具", tools.size === 2, [...tools.keys()].join(","));
check("novelai_tags_search 存在", tools.has("novelai_tags_search"));
check("novelai_tags_resolve 存在", tools.has("novelai_tags_resolve"));
check("注入了系统提示词段", promptSection !== null && typeof promptSection.text === "function");
check("提示词段文本非空", typeof promptSection?.text() === "string" && promptSection.text().length > 0);
check("技能 provider 已注册", skillProvider !== null);

console.log("\n参数清洗");
check("剥掉 {{}} 与权重", cleanQuery("{{long_hair}}") === "long_hair", cleanQuery("{{long_hair}}"));
check("剥掉 ::2:: 权重", cleanQuery("long_hair ::2::") === "long_hair", cleanQuery("long_hair ::2::"));
check("保留角色括号", cleanQuery("misaka_mikoto_(toaru_majutsu_no_index)") === "misaka_mikoto_(toaru_majutsu_no_index)");
check("中文原样保留", cleanQuery("  长发  ") === "长发");

console.log("\n错误路径");
const search = tools.get("novelai_tags_search");
async function expectError(label, fn, needle) {
  try {
    await fn();
    check(label, false, "没有抛错");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(label, message.includes(needle), message);
  }
}
await expectError("空 query 报错", () => search.execute({ query: "  " }, {}), "必填");
await expectError("非法 direction 报错", () => search.execute({ query: "x", direction: "bogus" }, {}), "direction");
await expectError("limit 越界报错", () => search.execute({ query: "x", limit: 99 }, {}), "limit");
await expectError("offset 越界报错", () => search.execute({ query: "x", offset: 10001 }, {}), "offset");
const resolve = tools.get("novelai_tags_resolve");
await expectError("concepts 空数组报错", () => resolve.execute({ concepts: [] }, {}), "concepts");
await expectError("concepts 含空串报错", () => resolve.execute({ concepts: ["a", " "] }, {}), "非空字符串");
await expectError("concepts 超上限报错", () => resolve.execute({ concepts: new Array(30).fill(0).map((_, i) => `c${i}`) }, {}), "最多");

// 宿主注册时的 schema 子集校验（与 dsh-tools 的 assertSupportedJsonSchema 同规则）：
// 只允许 type/oneOf/properties/required/additionalProperties/items/enum/const + 注解。
console.log("\n输出 schema 合规性");
const SUPPORTED = new Set(["type", "oneOf", "properties", "required", "additionalProperties", "items", "enum", "const", "description", "title", "default", "examples"]);
const TYPES = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);
// 输出里允许出现的可选字段：render 必须对缺失做兜底。工具的 parameters 允许可选（调用方可以省略）。
const OPTIONAL_OUTPUT = new Set(["error"]);
function auditSchema(node, path, out, strict) {
  if (node === null || typeof node !== "object" || Array.isArray(node)) {
    out.push(`${path} 不是 schema 对象`);
    return;
  }
  for (const key of Object.keys(node)) if (!SUPPORTED.has(key)) out.push(`${path}.${key} 不是受支持的 schema 关键字`);
  if (Object.hasOwn(node, "description") && typeof node.description !== "string") out.push(`${path}.description 必须是字符串`);
  if (Object.hasOwn(node, "type") && Object.hasOwn(node, "oneOf")) out.push(`${path} 不能同时声明 type 与 oneOf`);
  if (node.type !== void 0 && !TYPES.has(node.type)) out.push(`${path}.type 非法：${node.type}`);
  if (typeof node.description === "string" && node.description === "") out.push(`${path}.description 不能为空串`);
  if (node.properties !== void 0) {
    const required = Array.isArray(node.required) ? node.required : [];
    for (const key of required) {
      if (!Object.hasOwn(node.properties, key)) out.push(`${path}.required 引用了未声明的属性 ${key}`);
    }
    if (strict) {
      for (const key of Object.keys(node.properties)) {
        if (!required.includes(key) && !OPTIONAL_OUTPUT.has(key)) out.push(`${path} 的输出属性 ${key} 没进 required（render 会读到 undefined）`);
      }
    }
    for (const [key, child] of Object.entries(node.properties)) auditSchema(child, `${path}.properties.${key}`, out, strict);
  }
  if (node.items !== void 0) auditSchema(node.items, `${path}.items`, out, strict);
  if (Array.isArray(node.oneOf)) node.oneOf.forEach((branch, i) => auditSchema(branch, `${path}.oneOf[${i}]`, out, strict));
}
for (const [toolName, definition] of tools) {
  const problems = [];
  auditSchema(definition.output.schema, "output", problems, true);
  auditSchema(definition.parameters, "parameters", problems, false);
  check(`${toolName} schema 合规`, problems.length === 0, problems.join("；"));
  check(`${toolName} 参数拒绝多余字段`, definition.parameters.additionalProperties === false);
  check(`${toolName} 有 output.render`, typeof definition.output.render === "function");
  check(`${toolName} 声明为并发安全`, definition.isConcurrencySafe({}) === true);
}
try {
  const text = tools.get("novelai_tags_search").output.render({}, {
    query: "q", direction: "auto", source: "local", limit: 1, offset: 0,
    total: 0, hasMore: false, count: 0, results: []
  });
  check("空结果也能渲染", Array.isArray(text) && typeof text[0].text === "string" && text[0].text.length > 0);
} catch (error) {
  check("空结果也能渲染", false, error instanceof Error ? error.message : String(error));
}

console.log("\n真实查询（网络）");
try {
  const zh = await search.execute({ query: "长发", direction: "zh-to-tag", limit: 3 }, {});
  check("zh-to-tag 有结果", zh.count > 0, JSON.stringify(zh.results[0] ?? null));
  check("输出无 null 字段", JSON.stringify(zh).includes("null") === false);
  check("渲染出文本", search.output.render({}, zh)[0].text.includes("长发"));
  console.log(search.output.render({}, zh)[0].text.split("\n").slice(0, 4).join("\n"));

  const tag = await search.execute({ query: "{{misaka_mikoto}}", direction: "tag-to-zh", limit: 1 }, {});
  check("权重语法被清理后仍命中", tag.count === 1 && tag.results[0].tag === "misaka_mikoto", JSON.stringify(tag.results[0] ?? null));

  const empty = await search.execute({ query: "zzzz_not_a_tag_zzzz", limit: 3 }, {});
  check("无匹配返回 0 条且不抛错", empty.count === 0 && empty.total === 0);

  const batch = await resolve.execute({ concepts: ["长发", "白色水手服", "zzzz_nope"] }, {});
  check("批量返回 3 项", batch.concepts.length === 3);
  check("无匹配被记录", batch.unmatched.includes("zzzz_nope"), JSON.stringify(batch.unmatched));
  check("去重生效", (await resolve.execute({ concepts: ["长发", "长发"] }, {})).concepts.length === 1);
} catch (error) {
  check("网络查询", false, error instanceof Error ? error.message : String(error));
}

console.log(`\n${failures.length === 0 ? "全部通过" : `${failures.length} 项失败`}`);
if (failures.length > 0) {
  for (const item of failures) console.log(` - ${item}`);
  process.exit(1);
}
