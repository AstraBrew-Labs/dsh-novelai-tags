/**
 * 打包自检：把 npm tarball 当成最终交付物来验，而不是验源码目录。
 *
 * 步骤：解包 → 断言必需文件都在、禁运文件都没混进来 → 校验 manifest 的所有
 * 相对路径都真实存在 → 用假 ctx 加载**解包后的**副本并真跑一次网络查询。
 * 最后一步是关键：它证明 tarball 是自包含的，不会在别人机器上缺文件。
 *
 * 用法：node scripts/pack-check.mjs [tarball]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(new URL("..", import.meta.url).pathname);
const problems = [];
const notes = [];

function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    problems.push(`${label}${detail === void 0 ? "" : ` — ${detail}`}`);
    console.log(`  FAIL ${label}${detail === void 0 ? "" : ` — ${detail}`}`);
  }
}

// ---------------------------------------------------------------- 定位 tarball

const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const expectedName = `${manifest.name}-${manifest.version}.tgz`;
const tarball = resolve(process.argv[2] ?? join(root, expectedName));

console.log(`打包自检：${tarball}`);
if (!existsSync(tarball)) {
  console.error(`找不到 tarball：${tarball}\n先跑：npm pack`);
  process.exit(1);
}

const workdir = mkdtempSync(join(tmpdir(), "dsh-novelai-tags-pack-"));
const pkgDir = join(workdir, "package");

try {
  execFileSync("tar", ["-xzf", tarball, "-C", workdir], { stdio: "pipe" });
  check("tarball 可解包", existsSync(pkgDir));

  // -------------------------------------------------------------- 文件清单
  console.log("\n文件清单");
  const shipped = [];
  (function walk(dir, prefix) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(join(dir, entry.name), rel);
      else shipped.push(rel);
    }
  })(pkgDir, "");
  shipped.sort();
  for (const file of shipped) notes.push(`  ${file}`);

  const REQUIRED = [
    "package.json",
    "cordis.patch.yml",
    "lib/index.js",
    "lib/api.js",
    "skills/novelai-tags-search/SKILL.md",
    "README.md",
    "LICENSE"
  ];
  for (const file of REQUIRED) check(`包含 ${file}`, shipped.includes(file));
  for (const forbidden of ["test", "node_modules", "scripts"]) {
    const leaked = shipped.filter((file) => file === forbidden || file.startsWith(`${forbidden}/`));
    check(`不打包 ${forbidden}/`, leaked.length === 0, leaked.join(", "));
  }
  check("没有 .DS_Store", shipped.every((file) => !file.includes(".DS_Store")));

  // 分发健康度：包里不能有打包机器的绝对路径、用户名或凭据
  console.log("\n分发健康度");
  const LEAK_PATTERN = /\/Users\/|\/home\/|\/private\/tmp|C:\\\\Users\\\\/;
  const CRED_PATTERN = /(api[_-]?key|secret|password|bearer\s+[A-Za-z0-9._-]{8,})/i;
  const pathLeaks = [];
  const credLeaks = [];
  for (const file of shipped) {
    if (!/\.(js|mjs|json|ya?ml|md)$/.test(file)) continue;
    const text = readFileSync(join(pkgDir, file), "utf8");
    for (const [index, line] of text.split("\n").entries()) {
      if (LEAK_PATTERN.test(line)) pathLeaks.push(`${file}:${index + 1}`);
      if (CRED_PATTERN.test(line)) credLeaks.push(`${file}:${index + 1}`);
    }
  }
  check("没有打包机的绝对路径/用户名", pathLeaks.length === 0, pathLeaks.join(", "));
  check("没有凭据痕迹", credLeaks.length === 0, credLeaks.join(", "));

  // -------------------------------------------------------------- manifest
  console.log("\nmanifest 路径有效性");
  const packed = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  check("name 一致", packed.name === manifest.name, `${packed.name} vs ${manifest.name}`);
  check("version 一致", packed.version === manifest.version, `${packed.version} vs ${manifest.version}`);

  const referenced = [
    ["main", packed.main],
    ["exports['.']", packed.exports?.["."]],
    ["dsh.bundle.patch", packed.dsh?.bundle?.patch]
  ];
  for (const [label, path] of referenced) {
    check(`${label} → ${path} 存在`, typeof path === "string" && existsSync(join(pkgDir, path)));
  }
  check("dsh.bundle.patch 是相对路径", String(packed.dsh?.bundle?.patch ?? "").startsWith("./"));
  check("声明了 dsh.engines.dsh", typeof packed.dsh?.engines?.dsh === "string");
  check("license 是 MIT", packed.license === "MIT" && shipped.includes("LICENSE"));

  // cordis.patch.yml 的结构（真正的 YAML 合法性由装载 profile 验，这里只查关键行）
  const patch = readFileSync(join(pkgDir, "cordis.patch.yml"), "utf8");
  check("patch 里有 insert 列表", /^\s*-\s*insert:/m.test(patch));
  check("patch 的 name 指向本包", patch.includes(`'${packed.name}'`) || patch.includes(`"${packed.name}"`), "未找到包名");

  // ------------------------------------------------- 加载解包后的副本并跑真查询
  console.log("\n装载解包副本（假 ctx）");
  const tools = new Map();
  let skillProviderFactory = null;
  let promptSection = null;
  const fakeCtx = {
    tools: { register: (d) => tools.set(d.name, d) },
    systemPrompt: { section: (s) => { promptSection = s; } },
    inject: (_names, cb) => cb({ skills: { registerProvider: (p) => { skillProviderFactory = p; } } })
  };
  const entry = pathToFileURL(join(pkgDir, "lib/index.js")).href;
  const mod = await import(entry);
  mod.apply(fakeCtx, {});
  check("导出 apply/inject/name", typeof mod.apply === "function" && Array.isArray(mod.inject) && typeof mod.name === "string");
  check("注册了 2 个工具", tools.size === 2, [...tools.keys()].join(","));
  check("注入了提示词段", promptSection !== null && promptSection.text().length > 0);

  check("技能 provider 已注册（以工厂形式）", typeof skillProviderFactory === "function");
  const skillProvider = typeof skillProviderFactory === "function" ? skillProviderFactory() : null;
  const list = await skillProvider?.list();
  check("技能 provider 可列目录", Array.isArray(list) && list.length === 1, JSON.stringify(list?.[0]?.name));
  check("技能 resourceBase 指向包内目录（解包后仍在）", existsSync(list?.[0]?.resourceBase?.path ?? ""));
  const body = await skillProvider?.get();
  check("技能正文能读出来（证明 skills/ 已打进包）", typeof body?.content === "string" && body.content.length > 200, `${body?.content?.length ?? 0} 字符`);
  check("技能正文已剥掉 frontmatter", !String(body?.content ?? "").startsWith("---"));

  console.log("\n真实网络查询（用打包后的代码）");
  try {
    const result = await tools.get("novelai_tags_search").execute({ query: "长发", direction: "zh-to-tag", limit: 3 }, {});
    check("查询有结果", result.count > 0, JSON.stringify(result.results[0] ?? null));
    check("输出无 null 字段", !JSON.stringify(result).includes("null"));
    const text = tools.get("novelai_tags_search").output.render({}, result)[0].text;
    check("渲染正常", text.includes("long_hair"), text.split("\n")[0]);
  } catch (error) {
    check("真实网络查询", false, error instanceof Error ? error.message : String(error));
  }

  console.log("\n包内文件：");
  for (const line of notes) console.log(line);
} finally {
  rmSync(workdir, { recursive: true, force: true });
}

console.log(`\n${problems.length === 0 ? "打包自检全部通过" : `${problems.length} 项失败`}`);
if (problems.length > 0) {
  for (const item of problems) console.log(` - ${item}`);
  process.exit(1);
}
