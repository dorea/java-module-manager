# Java Module Manager

Eclipse-style **Close Project** for Maven multi-module projects in VS Code.

When you open a large Maven multi-module workspace, `redhat.java` (Eclipse JDT behind the scenes)
imports **every** module and keeps compiling all of them — high CPU, high memory, slow startup.
This extension lets you "close" the modules you are not working on, just like Eclipse's
*Close Project*: closed modules are not imported and not compiled, while everything else keeps working.

---

## Features

- **Status bar**: shows `Java 3/20` (enabled/total). Click it to pick modules with a multi-select list — enabled modules are pre-checked.
- **Explorer right-click** on a module folder → *Java Modules: Open/Close This Module*.
- **Editor right-click** → opens/closes the module that owns the current file (menu label follows the current state).
- **Closed modules are marked** with a `⊘` badge in the Explorer (color `#7A8FA3`, customizable).
- **Presets**: save the current selection as a named preset (e.g. "order-service-dev") and restore it with one command.
- **Dependency awareness**:
  - Closing a module that other **enabled** modules depend on shows a warning — those modules would fall back to the jar in your local `.m2` (possibly stale).
  - Enabling a module automatically enables its in-workspace dependencies.
- **Bilingual**: English / 中文, following the VS Code display language.

## Usage

1. Open your multi-module Maven workspace.
2. Click `Java n/m` in the status bar (bottom right).
3. Check the modules you want compiled, press Enter.
4. Apply the change: *Reload Window* (fast, keeps compiled cache) or *Clean and Restart*.

> Closing a module that is already imported requires a **workspace clean** to disappear from the
> Java Projects view; mere reload is not always enough. The notification offers the right button.

## How it works

The extension maintains the module entries in `java.import.exclusions`
(workspace `.vscode/settings.json`):

```json
"java.import.exclusions": [
    "**/node_modules/**",
    "**/.metadata/**",
    "**/archetype-resources/**",
    "**/META-INF/maven/**",
    "**/module-i-closed/**",
    "**/module-i-closed"
]
```

- Only its own managed entries (`**/<module-folder>/**`) are added or removed —
  any rules you wrote yourself are preserved, and the official defaults are always ensured.
- Modules are discovered by scanning for `pom.xml` (plain XML parsing, no `mvn` invocation).
- Dependencies are read from each module's `<dependencies>` (not `parent`, `dependencyManagement`, or `profiles`).
- Closed modules are **not** removed from global search (`grep`) or the file watcher — you can still search across them, they simply do not participate in compilation and Java language features.

## Settings

| Setting | Default | Description |
|---|---|---|
| `javaModuleManager.pinnedModules` | `[]` | Optional. Modules (by `artifactId` or folder name) that always stay enabled and cannot be unchecked. |
| `javaModuleManager.maxScanDepth` | `5` | Maximum directory depth to scan for `pom.xml`. |

Color of the closed-module badge:

```json
"workbench.colorCustomizations": {
    "javaModuleManager.closedModule": "#7A8FA3"
}
```

## Requirements

- VS Code 1.85+
- The [Extension Pack for Java](https://marketplace.visualstudio.com/items?itemName=vscjava.vscode-java-pack) (or at least `redhat.java`)

## Related tips

- `"java.import.mode": "ondemand"` (redhat.java 1.5x+) imports a module only when you open a file in it —
  complementary to this extension and good for cold start times.

---

# 中文说明

Eclipse **Close Project** 的 VS Code 版，针对 Maven 多模块工程。

打开大型 Maven 多模块工程时，`redhat.java`（底层是 Eclipse JDT）会把**所有**模块导入并持续编译，
CPU 和内存吃满、启动很慢。本扩展让你把暂时不用的模块"关闭"：被关闭的模块不导入、不编译，
其余模块照常工作。

## 功能

- **状态栏**：右下角显示 `Java 3/20`（启用/总数），点击弹出多选框，已启用的默认勾选。
- **资源管理器右键**模块文件夹 →「Java 模块: 开启/关闭此模块」。
- **编辑器右键** → 开关当前文件所属模块（菜单文字跟随当前状态变化）。
- **已关闭的模块**在资源管理器中带 `⊘` 角标（颜色 `#7A8FA3`，可自定义）。
- **预设**：把当前选择存成命名预设（如「订单服务开发」），一条命令切换回来。
- **依赖感知**：
  - 关闭被其他**启用**模块依赖的模块时会弹警告——那些模块会改用本地 `.m2` 里的 jar（可能已过期）。
  - 启用某模块时自动连带启用它在工作区内的依赖。
- **中英双语**：跟随 VS Code 界面语言。

## 使用步骤

1. 打开多模块 Maven 工程。
2. 点击右下角状态栏 `Java n/m`。
3. 勾选要编译的模块，回车确认。
4. 选择生效方式：*重载窗口*（快，保留编译缓存）或 *清理并重启*。

> 关闭一个**已经被导入**的模块，需要执行一次工作区清理才会从 Java Projects 视图消失，
> 仅重载窗口不一定够。通知里会给出对应的按钮。

## 工作原理

扩展维护 `java.import.exclusions`（工作区 `.vscode/settings.json`）中的模块条目，
只增删自己管理的 `**/<模块文件夹>/**`，你手写的其他规则原样保留，官方默认四条始终确保存在。

模块列表来自扫描 `pom.xml`（纯 XML 解析，不调用 `mvn`）；依赖只读取各模块的 `<dependencies>`
（不含 `parent`、`dependencyManagement`、`profiles`）。

被关闭的模块**不会**从全局搜索和文件监视中排除——你仍然可以跨模块搜代码，只是它们不参与编译和 Java 语言特性。

## 设置

| 设置项 | 默认值 | 说明 |
|---|---|---|
| `javaModuleManager.pinnedModules` | `[]` | 可选。锁定常驻模块（按 `artifactId` 或文件夹名），始终启用且不可取消。 |
| `javaModuleManager.maxScanDepth` | `5` | 扫描 `pom.xml` 的最大目录深度。 |

## 环境要求

- VS Code 1.85+
- Extension Pack for Java（或至少 `redhat.java`）

## License

MIT
