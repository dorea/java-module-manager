import * as vscode from 'vscode';
import * as path from 'path';
import { ModuleInfo, scanRoots } from './lib/scan';
import { buildGraph, DepGraph } from './lib/depgraph';
import { arraysEqual, isModuleExcluded, mergeExclusions } from './lib/exclusions';

const PRESETS_KEY = 'javaModuleManager.presets';
const CTX_ENABLED = 'javaModuleManager.moduleEnabled';

/** 标点级别的小切换（正式句子走 vscode.l10n，跟随 VS Code 界面语言） */
const isZh = () => vscode.env.language.toLowerCase().startsWith('zh');

interface ModuleItem extends vscode.QuickPickItem {
  folder: string;
}

function norm(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase().replace(/\//g, '\\') : p;
}

function label(m: ModuleInfo): string {
  return m.folder === m.artifactId ? m.folder : vscode.l10n.t('{0} ({1})', m.folder, m.artifactId);
}

function fmtList(list: string[]): string {
  const sep = isZh() ? '、' : ', ';
  const head = list.slice(0, 3).join(sep);
  return list.length <= 3 ? head : (isZh() ? `${head} 等 ${list.length} 个` : `${head} and ${list.length} more`);
}

/** 关闭模块的角标颜色：自定义主题色 javaModuleManager.closedModule（默认 #7A8FA3，见 package.json contributes.colors） */
const CLOSED_COLOR = new vscode.ThemeColor('javaModuleManager.closedModule');

class ModuleManager {
  modules: ModuleInfo[] = [];
  graph: DepGraph = buildGraph([]);
  private byDir = new Map<string, ModuleInfo>();
  private statusItem: vscode.StatusBarItem;

  constructor(private context: vscode.ExtensionContext) {
    this.statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusItem.name = 'Java Module Manager';
    this.statusItem.command = 'javaModuleManager.select';
    context.subscriptions.push(this.statusItem);
    context.subscriptions.push(
      vscode.window.registerFileDecorationProvider({
        onDidChangeFileDecorations: this.decorationsEmitter.event,
        provideFileDecoration: (uri) => this.provideDecoration(uri),
      }),
    );
  }

  rescan(): void {
    const roots = vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? [];
    const depth = vscode.workspace.getConfiguration('javaModuleManager').get<number>('maxScanDepth', 5);
    this.modules = roots.length ? scanRoots(roots, depth) : [];
    this.graph = buildGraph(this.modules);
    this.byDir = new Map(this.modules.map((m) => [norm(m.dir), m]));
    this.refresh();
  }

  /** 可切换的模块（workspace 根模块 '' 除外，它无法排除） */
  toggleable(): ModuleInfo[] {
    return this.modules.filter((m) => m.folder !== '');
  }

  pinnedFolders(): Set<string> {
    const pinned = vscode.workspace.getConfiguration('javaModuleManager').get<string[]>('pinnedModules', []);
    return new Set(
      this.toggleable()
        .filter((m) => pinned.includes(m.artifactId) || pinned.includes(m.folder))
        .map((m) => m.folder),
    );
  }

  private decorationsEmitter = new vscode.EventEmitter<undefined | vscode.Uri[]>();
  private _disabledCache: Set<string> | null = null;

  disabledFolders(): Set<string> {
    if (this._disabledCache) {
      return this._disabledCache;
    }
    const patterns = vscode.workspace.getConfiguration('java').get<string[]>('import.exclusions', []);
    this._disabledCache = new Set(
      this.toggleable()
        .filter((m) => isModuleExcluded(patterns, m.folder))
        .map((m) => m.folder),
    );
    return this._disabledCache;
  }

  enabledFolders(): Set<string> {
    const disabled = this.disabledFolders();
    return new Set(this.toggleable().filter((m) => !disabled.has(m.folder)).map((m) => m.folder));
  }

  /** 文件/文件夹所在的最深层模块 */
  moduleForPath(fsPath: string): ModuleInfo | undefined {
    const n = norm(fsPath);
    let best: ModuleInfo | undefined;
    for (const m of this.modules) {
      const d = norm(m.dir);
      if (n === d || n.startsWith(d + path.sep) || n.startsWith(d + '/')) {
        if (!best || m.dir.length > best.dir.length) {
          best = m;
        }
      }
    }
    return best;
  }

  refresh(): void {
    this._disabledCache = null; // 配置可能已变，下次调用时重算
    this.decorationsEmitter.fire(undefined);
    const all = this.toggleable();
    if (all.length === 0) {
      this.statusItem.hide();
      void vscode.commands.executeCommand('setContext', CTX_ENABLED, undefined);
      return;
    }
    const enabled = this.enabledFolders();
    const disabled = [...this.disabledFolders()];
    this.statusItem.text = `$(layers) Java ${enabled.size}/${all.length}`;
    const md = new vscode.MarkdownString(`**${vscode.l10n.t('Java Modules: {0}/{1} enabled', String(enabled.size), String(all.length))}**\n\n`);
    md.appendMarkdown(
      enabled.size
        ? `${vscode.l10n.t('Enabled:')} ${[...enabled].map((f) => `\`${f}\``).join(' ')}\n\n`
        : `_${vscode.l10n.t('No enabled modules')}_\n\n`,
    );
    md.appendMarkdown(
      disabled.length ? `${vscode.l10n.t('Closed:')} ${disabled.map((f) => `\`${f}\``).join(' ')}\n\n` : '',
    );
    md.appendMarkdown(vscode.l10n.t('Click this status bar item to change the selection.'));
    this.statusItem.tooltip = md;
    this.statusItem.show();
    this.updateEditorContext();
  }

  /** Explorer 角标：已关闭模块的根文件夹显示 ⊘（颜色 #7A8FA3） */
  private provideDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const m = this.moduleForPath(uri.fsPath);
    if (!m || m.folder === '') {
      return undefined;
    }
    if (norm(uri.fsPath) !== norm(m.dir)) {
      return undefined; // 只标模块根文件夹，不标内部文件
    }
    if (!this.disabledFolders().has(m.folder)) {
      return undefined;
    }
    return new vscode.FileDecoration('⊘', vscode.l10n.t('Closed'), CLOSED_COLOR);
  }

  updateEditorContext(): void {
    const file = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!file) {
      void vscode.commands.executeCommand('setContext', CTX_ENABLED, undefined);
      return;
    }
    const m = this.moduleForPath(file);
    if (!m || m.folder === '') {
      void vscode.commands.executeCommand('setContext', CTX_ENABLED, undefined);
      return;
    }
    void vscode.commands.executeCommand('setContext', CTX_ENABLED, !this.disabledFolders().has(m.folder));
  }

  // ---- 应用变更 ----

  /**
   * 把"请求启用的集合"落到 settings：补上锁定模块和依赖闭包，写 java.import.exclusions，
   * 弹生效提示。
   */
  async applyRequested(requested: Set<string>): Promise<void> {
    const all = this.toggleable();
    if (all.length === 0) {
      void vscode.window.showInformationMessage(vscode.l10n.t('No Maven modules found (no pom.xml detected in the workspace).'));
      return;
    }
    const pinned = this.pinnedFolders();
    const final = this.graph.closure(new Set([...requested, ...pinned]));
    const autoAdded = new Set([...final].filter((f) => !requested.has(f) && !pinned.has(f)));

    const beforeDisabled = this.disabledFolders();
    const disabled = all.map((m) => m.folder).filter((f) => !final.has(f)).sort();

    const config = vscode.workspace.getConfiguration('java');
    const current = config.get<string[]>('import.exclusions') ?? [];
    const next = mergeExclusions(current, disabled, all.map((m) => m.folder));
    if (arraysEqual(current, next)) {
      void vscode.window.showInformationMessage(vscode.l10n.t('Java module selection unchanged.'));
      return;
    }
    await config.update('import.exclusions', next, vscode.ConfigurationTarget.Workspace);
    this.refresh();

    const newlyDisabled = disabled.filter((f) => !beforeDisabled.has(f));
    const newlyEnabled = [...beforeDisabled].filter((f) => !disabled.includes(f));
    const parts: string[] = [vscode.l10n.t('Enabled {0}/{1}', String(final.size), String(all.length))];
    if (newlyDisabled.length) parts.push(vscode.l10n.t('Closed: {0}', fmtList(newlyDisabled)));
    if (newlyEnabled.length) parts.push(vscode.l10n.t('Opened: {0}', fmtList(newlyEnabled)));
    if (autoAdded.size) parts.push(vscode.l10n.t('Auto-enabled dependencies: {0}', fmtList([...autoAdded])));
    const summary = parts.join(isZh() ? '；' : '; ');
    // 有关闭操作时，已导入的项目要清理工作区才会从 Java 视图移除（重载窗口不够）；只启用时重载即可
    const disabling = newlyDisabled.length > 0;
    const msg = disabling
      ? vscode.l10n.t('Java modules updated: {0}. Closed modules only disappear from the Java view after a workspace clean — "Clean and Restart" is recommended.', summary)
      : vscode.l10n.t('Java modules updated: {0}. Reload the window to apply.', summary);
    const buttons = disabling
      ? [vscode.l10n.t('Clean and Restart'), vscode.l10n.t('Reload Window')]
      : [vscode.l10n.t('Reload Window')];
    const choice = await vscode.window.showInformationMessage(msg, ...buttons);
    if (choice === vscode.l10n.t('Reload Window')) {
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    } else if (choice === vscode.l10n.t('Clean and Restart')) {
      await vscode.commands.executeCommand('java.clean.workspace');
    }
  }

  async toggleModule(m: ModuleInfo): Promise<void> {
    if (m.folder === '') {
      void vscode.window.showWarningMessage(vscode.l10n.t('The workspace root module cannot be closed (it is the entire workspace).'));
      return;
    }
    const pinned = this.pinnedFolders();
    const disabled = this.disabledFolders();
    if (disabled.has(m.folder)) {
      // 开启：连带依赖
      const requested = this.enabledFolders();
      requested.add(m.folder);
      await this.applyRequested(requested);
      return;
    }
    // 关闭：锁定模块拒绝；被启用模块依赖时警告
    if (pinned.has(m.folder)) {
      void vscode.window.showWarningMessage(
        vscode.l10n.t('{0} is a pinned module (javaModuleManager.pinnedModules) and stays enabled.', label(m)),
      );
      return;
    }
    const enabledNow = this.enabledFolders();
    const affected = new Set<string>();
    const stack = [m.folder];
    while (stack.length) {
      const f = stack.pop()!;
      for (const d of this.graph.dependentsOf(f)) {
        if (enabledNow.has(d) && !affected.has(d)) {
          affected.add(d);
          stack.push(d);
        }
      }
    }
    if (affected.size > 0) {
      const names = [...affected].map((f) => this.modules.find((x) => x.folder === f)?.artifactId ?? f);
      const go = await vscode.window.showWarningMessage(
        vscode.l10n.t(
          'The following enabled modules depend on {0}: {1}. If you close it, they will compile against the old jar in your local .m2 repository (possibly stale or broken).',
          label(m),
          fmtList(names),
        ),
        { modal: true },
        vscode.l10n.t('Close anyway'),
      );
      if (go !== vscode.l10n.t('Close anyway')) {
        return;
      }
    }
    const requested = enabledNow;
    requested.delete(m.folder);
    await this.applyRequested(requested);
  }

  // ---- 命令 ----

  async cmdSelect(): Promise<void> {
    const all = this.toggleable();
    if (all.length === 0) {
      void vscode.window.showInformationMessage(vscode.l10n.t('No Maven modules found (no pom.xml detected in the workspace).'));
      return;
    }
    const disabled = this.disabledFolders();
    const pinned = this.pinnedFolders();
    const rank = (m: ModuleInfo) => (pinned.has(m.folder) ? 0 : disabled.has(m.folder) ? 2 : 1);
    const items: ModuleItem[] = [...all]
      .sort((a, b) => rank(a) - rank(b) || a.folder.localeCompare(b.folder))
      .map((m) => ({
        folder: m.folder,
        label: pinned.has(m.folder) ? `$(lock) ${m.folder}` : m.folder,
        description: pinned.has(m.folder)
          ? vscode.l10n.t('Base module (pinned)')
          : disabled.has(m.folder)
            ? vscode.l10n.t('Closed')
            : '',
        detail: `${m.groupId || '?'}:${m.artifactId} · ${m.packaging}`,
        picked: pinned.has(m.folder) || !disabled.has(m.folder),
      }));

    const pickedItems = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      matchOnDescription: true,
      matchOnDetail: true,
      placeHolder: vscode.l10n.t('Checked = enabled (imported and compiled); unchecked = closed. Enabled modules are pre-checked. Enter to confirm.'),
    });
    if (!pickedItems) {
      return; // Esc 取消
    }
    const selected = new Set(pickedItems.map((i) => i.folder));
    const unCheckedPinned = [...pinned].filter((f) => !selected.has(f));
    if (unCheckedPinned.length > 0) {
      void vscode.window.showInformationMessage(
        vscode.l10n.t('Pinned modules kept enabled automatically: {0}', fmtList(unCheckedPinned)),
      );
    }
    await this.applyRequested(selected);
  }

  async cmdToggleFolder(uri?: vscode.Uri): Promise<void> {
    if (!uri) {
      return;
    }
    const m = this.moduleForPath(uri.fsPath);
    if (!m) {
      void vscode.window.showInformationMessage(vscode.l10n.t('This folder is not a Maven module (no pom.xml detected).'));
      return;
    }
    await this.toggleModule(m);
  }

  async cmdToggleEditor(): Promise<void> {
    const file = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!file) {
      return;
    }
    const m = this.moduleForPath(file);
    if (!m || m.folder === '') {
      void vscode.window.showInformationMessage(vscode.l10n.t('The current file is not inside any Maven module.'));
      return;
    }
    await this.toggleModule(m);
  }

  // ---- 预设 ----

  private getPresets(): Record<string, string[]> {
    return this.context.workspaceState.get<Record<string, string[]>>(PRESETS_KEY, {});
  }

  private async setPresets(p: Record<string, string[]>): Promise<void> {
    await this.context.workspaceState.update(PRESETS_KEY, p);
  }

  async cmdSavePreset(): Promise<void> {
    if (this.toggleable().length === 0) {
      return;
    }
    const presets = this.getPresets();
    const name = await vscode.window.showInputBox({
      prompt: vscode.l10n.t('Preset name, e.g. order-service-dev'),
      validateInput: (v) => (v.trim() ? undefined : vscode.l10n.t('Name cannot be empty')),
    });
    if (!name) {
      return;
    }
    const overwrite = vscode.l10n.t('Overwrite');
    if (presets[name] && (await vscode.window.showWarningMessage(vscode.l10n.t('Preset "{0}" already exists. Overwrite?', name), { modal: true }, overwrite)) !== overwrite) {
      return;
    }
    presets[name] = [...this.enabledFolders()].sort();
    await this.setPresets(presets);
    void vscode.window.showInformationMessage(
      vscode.l10n.t('Preset "{0}" saved: {1} modules.', name, String(presets[name].length)),
    );
  }

  async cmdApplyPreset(): Promise<void> {
    const presets = this.getPresets();
    const names = Object.keys(presets);
    if (names.length === 0) {
      void vscode.window.showInformationMessage(
        vscode.l10n.t('No presets yet. Save one first with "Java Modules: Save Current Selection as Preset".'),
      );
      return;
    }
    const pick = vscode.window.createQuickPick<vscode.QuickPickItem>();
    const items = () =>
      names
        .sort((a, b) => a.localeCompare(b))
        .map((n) => ({
          label: n,
          detail: presets[n].join(isZh() ? '、' : ', '),
          buttons: [{ iconPath: new vscode.ThemeIcon('trash'), tooltip: vscode.l10n.t('Delete this preset') }],
        }));
    pick.placeholder = vscode.l10n.t('Select a preset to apply (trash icon deletes)');
    pick.items = items();
    pick.show();
    let applied = false;
    pick.onDidTriggerItemButton(async (e) => {
      const name = e.item.label;
      delete presets[name];
      names.splice(names.indexOf(name), 1);
      await this.setPresets(presets);
      pick.items = items();
      void vscode.window.showInformationMessage(vscode.l10n.t('Preset "{0}" deleted.', name));
    });
    pick.onDidAccept(async () => {
      const name = pick.selectedItems[0]?.label;
      applied = !!name;
      pick.hide();
      if (name) {
        await this.applyRequested(new Set(presets[name]));
      }
    });
    pick.onDidHide(() => {
      if (!applied) {
        pick.dispose();
      }
    });
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const mgr = new ModuleManager(context);
  mgr.rescan();

  const reg = (id: string, cb: (...args: never[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, cb as never));
  reg('javaModuleManager.select', () => mgr.cmdSelect());
  reg('javaModuleManager.toggleFolder', (uri: vscode.Uri) => mgr.cmdToggleFolder(uri));
  reg('javaModuleManager.toggleEditorDisable', () => mgr.cmdToggleEditor());
  reg('javaModuleManager.toggleEditorEnable', () => mgr.cmdToggleEditor());
  reg('javaModuleManager.savePreset', () => mgr.cmdSavePreset());
  reg('javaModuleManager.applyPreset', () => mgr.cmdApplyPreset());
  reg('javaModuleManager.rescan', () => {
    mgr.rescan();
    void vscode.window.showInformationMessage(
      vscode.l10n.t('Rescanned: {0} Maven modules.', String(mgr.toggleable().length)),
    );
  });

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => mgr.updateEditorContext()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('java.import.exclusions') || e.affectsConfiguration('javaModuleManager')) {
        mgr.refresh();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => mgr.rescan()),
  );
}

export function deactivate(): void {
  // 无需清理（状态栏已进 subscriptions）
}
