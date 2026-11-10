/**
 * java.import.exclusions 的"受管条目"合并逻辑。
 * 本扩展只增删针对模块文件夹的 glob 受管条目，用户手写的其他规则原样保留。
 */

/** vscode-java 的官方默认值（写入时始终确保存在，防止用户误删） */
export const DEFAULT_EXCLUSIONS = [
  '**/node_modules/**',
  '**/.metadata/**',
  '**/archetype-resources/**',
  '**/META-INF/maven/**',
];

/** 某个模块文件夹对应的两条受管 pattern（内容 + 文件夹本身，参考 vscode-java 官方 issue 的推荐写法） */
export function managedPatterns(folder: string): string[] {
  return [`**/${folder}/**`, `**/${folder}`];
}

/** 该模块是否已被排除（两条 pattern 任一存在即算） */
export function isModuleExcluded(patterns: readonly string[], folder: string): boolean {
  return managedPatterns(folder).some((p) => patterns.includes(p));
}

/**
 * 计算新的 exclusions 数组：
 * 1. 先放官方默认四条；
 * 2. 保留当前数组里不属于任何已知模块的条目（用户手写规则）；
 * 3. 追加所有"被关闭"模块的受管 pattern。
 */
export function mergeExclusions(
  current: readonly string[] | undefined,
  disabledFolders: readonly string[],
  allModuleFolders: readonly string[],
): string[] {
  const knownManaged = new Set<string>();
  for (const f of allModuleFolders) {
    for (const p of managedPatterns(f)) {
      knownManaged.add(p);
    }
  }
  const result: string[] = [...DEFAULT_EXCLUSIONS];
  for (const p of current ?? []) {
    if (!knownManaged.has(p) && !result.includes(p)) {
      result.push(p);
    }
  }
  for (const f of disabledFolders) {
    for (const p of managedPatterns(f)) {
      if (!result.includes(p)) {
        result.push(p);
      }
    }
  }
  return result;
}

export function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
