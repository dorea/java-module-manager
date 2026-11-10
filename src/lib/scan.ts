import * as fs from 'fs';
import * as path from 'path';
import { parsePom } from './pom';

export interface ModuleInfo {
  /** 相对 workspace 根目录的文件夹路径（'/' 分隔）；'' 表示 workspace 根本身 */
  folder: string;
  /** 模块目录绝对路径 */
  dir: string;
  artifactId: string;
  /** 生效 groupId：自己的，否则继承 parent 的 */
  groupId: string;
  packaging: string;
  /** 依赖坐标 "groupId:artifactId"；缺 groupId 的记为 "*:artifactId" */
  deps: string[];
}

const SKIP_DIRS = new Set([
  'node_modules', 'target', '.git', '.vscode', '.idea', 'bin', 'dist', 'logs', 'work',
]);

export function scanRoots(roots: string[], maxDepth = 5): ModuleInfo[] {
  const modules: ModuleInfo[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    walk(root, root, 0);
  }

  function walk(root: string, dir: string, depth: number): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.isFile() && e.name === 'pom.xml')) {
      if (!seen.has(dir)) {
        seen.add(dir);
        const parsed = tryParse(path.join(dir, 'pom.xml'));
        if (parsed) {
          const folder = path.relative(root, dir).split(path.sep).join('/');
          modules.push(toModule(parsed, dir, folder));
        }
      }
    }
    if (depth >= maxDepth) {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || SKIP_DIRS.has(e.name)) {
        continue;
      }
      walk(root, path.join(dir, e.name), depth + 1);
    }
  }

  function tryParse(pomPath: string) {
    let xml: string;
    try {
      xml = fs.readFileSync(pomPath, 'utf-8');
    } catch {
      return undefined;
    }
    return parsePom(xml);
  }

  return modules;
}

function toModule(p: NonNullable<ReturnType<typeof parsePom>>, dir: string, folder: string): ModuleInfo {
  const groupId = p.groupId ?? p.parentGroupId ?? '';
  const deps = p.dependencies.map((d) => (d.groupId ? `${d.groupId}:${d.artifactId}` : `*:${d.artifactId}`));
  return { folder, dir, artifactId: p.artifactId, groupId, packaging: p.packaging, deps };
}
