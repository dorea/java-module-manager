import { ModuleInfo } from './scan';

export interface DepGraph {
  /** folder -> 它依赖的 workspace 内模块 folder 集合（含传递） */
  depsOf(folder: string): Set<string>;
  /** folder -> 直接依赖它的 workspace 内模块 folder 集合（不含传递） */
  dependentsOf(folder: string): Set<string>;
  /** 从 seeds 出发的依赖闭包（含 seeds 自身与所有传递依赖） */
  closure(seeds: Iterable<string>): Set<string>;
}

/**
 * 依据每个模块 <dependencies> 里的 g:a 匹配 workspace 内其他模块。
 * 只算编译依赖：parent / dependencyManagement / plugin 不算（parent 从 .m2 解析，关掉不报错）。
 */
export function buildGraph(modules: ModuleInfo[]): DepGraph {
  const byKey = new Map<string, string>(); // "g:a" -> folder
  const byArtifactId = new Map<string, string>(); // artifactId -> folder（处理 *:a 的缺 groupId 依赖）
  for (const m of modules) {
    if (!m.folder) {
      continue; // workspace 根模块不可排除，不参与
    }
    if (m.groupId) {
      byKey.set(`${m.groupId}:${m.artifactId}`, m.folder);
    }
    if (!byArtifactId.has(m.artifactId)) {
      byArtifactId.set(m.artifactId, m.folder);
    }
  }

  const deps = new Map<string, Set<string>>(); // folder -> 直接依赖的 folder
  const dependents = new Map<string, Set<string>>();
  for (const m of modules) {
    if (!m.folder) {
      continue;
    }
    const set = new Set<string>();
    for (const dep of m.deps) {
      const target = byKey.get(dep) ?? byArtifactId.get(dep.slice(2));
      if (target && target !== m.folder) {
        set.add(target);
      }
    }
    deps.set(m.folder, set);
    for (const t of set) {
      if (!dependents.has(t)) {
        dependents.set(t, new Set());
      }
      dependents.get(t)!.add(m.folder);
    }
  }

  const cache = new Map<string, Set<string>>();
  function depsOf(folder: string): Set<string> {
    const hit = cache.get(folder);
    if (hit) {
      return hit;
    }
    const result = new Set<string>([folder]);
    for (const d of deps.get(folder) ?? []) {
      for (const x of depsOf(d)) {
        result.add(x);
      }
    }
    cache.set(folder, result);
    return result;
  }

  return {
    depsOf,
    dependentsOf: (folder) => dependents.get(folder) ?? new Set<string>(),
    closure: (seeds) => {
      const result = new Set<string>();
      for (const s of seeds) {
        for (const x of depsOf(s)) {
          result.add(x);
        }
      }
      return result;
    },
  };
}
