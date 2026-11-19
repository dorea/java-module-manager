# 发布到 VS Code Marketplace

> 不需要 Azure DevOps，不需要 PAT（Azure DevOps 的全局 PAT 已于 2026-12-01 退役）。
> 两条路：**手动上传 vsix**（最快上线）或 **GitHub Actions + Trusted Publishing**（自动发布）。

---

## 一、创建 Publisher

1. 打开 <https://marketplace.visualstudio.com/manage>，用 Microsoft 账号登录（个人账号即可）
2. 左侧 **Create publisher**
   - **ID**：`dodo`（必须与 `package.json` 的 `publisher` 一致；全局唯一，**创建后不可修改**）
   - **Name**：显示名称，可中文
3. 创建完成

> `package.json` 里已配置：`publisher` = `dodo`，
> `repository` / `bugs` 指向 `github.com/dorea/java-module-manager`。
> **publisher 与 GitHub 账号名不同是正常的**：前者是 Marketplace 发布者 ID，后者是仓库归属。

---

## 二、手动上传（最快上线，无需任何 token）

```bash
cd <项目目录>
npm run build
npm run package          # 生成 java-module-manager-<版本号>.vsix
```

1. 进入 <https://marketplace.visualstudio.com/manage> 的 `dodo` publisher
2. **New extension** → **Visual Studio Code**
3. 拖入刚生成的 `.vsix` 文件
4. 等待处理（通常几分钟），扩展上线：

   `https://marketplace.visualstudio.com/items?itemName=dodo.java-module-manager`

> 搜索索引可能有延迟，直接用上面的 URL 可立即验证。
> 以后每次发版都可以这样手动传，完全不需要命令行和 token。

---

## 三、自动化发布（推荐，一次配置长期有效）

仓库已包含 `.github/workflows/publish.yml`，使用 Trusted Publishing（OIDC），**不存储任何密钥**。

### 3.1 创建信任策略

1. 进入 `dodo` publisher 页面
2. 点 **Trusted Publishing** → 展开 **Create**，填：

   | 字段 | 值 |
   |---|---|
   | Policy name | `Release workflow` |
   | Repository owner | `dorea` |
   | Repository | `java-module-manager` |
   | Workflow | `publish.yml` |
   | Environment | 留空 |

3. 点 **Create**

### 3.2 触发发布（已验证可用：v0.1.1）

```bash
git status                                   # 必须是干净的工作树
npm ci && npm run build && npm test          # 本地先过一遍，和 CI 完全同构
npm version patch -m "chore(release): %s"    # 升版本号 + 自动 commit + 打 tag
# package.json / package-lock.json 的 version 都会被 npm 一起改，不用手改
git push --follow-tags
```

Workflow 会自动：`npm ci` → 类型检查 + 构建 → 跑测试 → `vsce publish --oidc`。
执行结果在 GitHub 仓库的 **Actions** 页查看；不想开网页可以查 API：

```bash
curl -s "https://api.github.com/repos/dorea/java-module-manager/actions/runs?per_page=1" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s).workflow_runs[0];console.log(r.head_branch,r.status,r.conclusion,r.html_url)})"
```

> `--skip-duplicate` 已加上：版本号已存在时不会报错，可安全重跑。
> 若还没配好信任策略，就不要推 tag（推分支无影响），否则 Actions 会失败一次。

### 3.3 发布失败时怎么重试

先看失败在**哪一步**——`npm ci` 挂了就不要怀疑 OIDC，那是锁文件的问题：

```bash
curl -s "https://api.github.com/repos/dorea/java-module-manager/actions/runs/<run-id>/jobs" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{JSON.parse(s).jobs[0].steps.forEach(x=>console.log(x.number,x.name,'→',x.conclusion))})"
```

修完要重跑同一个版本号，得先删掉远端 tag 再重打（tag 一旦推过，同一个 tag 不会再触发）：

```bash
git push origin :refs/tags/v0.1.1 && git tag -d v0.1.1
# ...提交修复...
git push origin main
git tag -a v0.1.1 -m "v0.1.1" && git push origin v0.1.1
```

---

## 四、推代码到 GitHub

先在 GitHub 建一个空仓库（**不要**勾 README / .gitignore / license），然后：

```bash
cd <项目目录>
git init
git branch -M main
git add -A
git commit -m "Initial commit"
git remote add origin https://github.com/dorea/java-module-manager.git
git push -u origin main
```

---

## 五、常见报错对照

| 报错 | 原因 / 解决 |
|---|---|
| `ERROR Missing publisher name` | `package.json` 的 `publisher` 没填 |
| `ERROR This extension already exists` | 版本号必须大于线上版本；或改用 `--skip-duplicate` |
| `ERROR Extension entrypoint(s) missing` | 忘了 `npm run build`，`out/extension.js` 不存在 |
| `ERROR Make sure to edit the README.md` / 缺 repository | `repository.url` 不是合法地址 |
| Actions 里 OIDC 报 token exchange 失败 | 信任策略里的 owner / repo / workflow 与实际不符；私有仓库要在建策略后 48 小时内跑一次 |
| `npm ci` 报 `EUSAGE ... can only install packages when your package.json and package-lock.json are in sync` | 锁文件和 `package.json` 的版本范围对不上（v0.1.1 就是这么挂的：锁里是 vsce 4.1.0，`package.json` 还写着 `^3.2.0`）。改完依赖必须跑 `npm install` 重新生成 lock，并本地验证一次 `rm -rf node_modules && npm ci` |
| `--oidc` 报 unknown option | `@vscode/vsce` 版本太老，`--oidc` 是 4.x 才有的，devDependency 保持 `^4.1.0` |
| 发布成功但搜不到 | 索引延迟（几分钟到几小时）；直接访问扩展 URL 可立即验证 |
| `dodo` 已被占用 | 换 ID，只需改 `package.json` 的 `publisher`（`repository` / `bugs` 保持 `dorea`） |

---

## 六、本地打包检查

```bash
cd <项目目录>
npm run build
npm test                 # 纯逻辑自测
npx vsce ls              # 查看将要打包的文件清单
npm run package
```

打包内容应只有这些：`LICENSE`、`CHANGELOG`、`README`、`package.json`、两个 `package.nls*.json`、
`l10n/bundle.l10n.zh-cn.json`、`media/icon.png`、`out/extension.js`（含 sourcemap）。

`install.md`、`PUBLISH.md`、`.github/`、`src/`、`test/`、`tools/`、`.vscode/` 都不会进包（见 `.vscodeignore`）。
