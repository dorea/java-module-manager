import { XMLParser } from 'fast-xml-parser';

export interface ParsedPom {
  /** 本模块自己的 artifactId */
  artifactId: string;
  /** 自己声明的 groupId（可能缺省，继承 parent） */
  groupId?: string;
  parentGroupId?: string;
  parentArtifactId?: string;
  /** 默认 jar */
  packaging: string;
  /** 直接依赖（不含 dependencyManagement / plugins / profiles） */
  dependencies: { groupId?: string; artifactId: string }[];
}

const parser = new XMLParser({ ignoreAttributes: true });

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v.trim() : undefined;
}

/** 解析 pom.xml 文本。不是合法/没有 project 节点时返回 undefined。 */
export function parsePom(xml: string): ParsedPom | undefined {
  let doc: any;
  try {
    doc = parser.parse(xml);
  } catch {
    return undefined;
  }
  const project = doc?.project;
  if (!project || typeof project !== 'object') {
    return undefined;
  }
  const artifactId = str(project.artifactId);
  if (!artifactId) {
    return undefined;
  }
  const depsRaw = project.dependencies?.dependency ?? [];
  const depList = Array.isArray(depsRaw) ? depsRaw : [depsRaw];
  const dependencies = depList
    .map((d: any) => ({ groupId: str(d?.groupId), artifactId: str(d?.artifactId) ?? '' }))
    .filter((d: { artifactId: string }) => d.artifactId !== '');
  return {
    artifactId,
    groupId: str(project.groupId),
    parentGroupId: str(project.parent?.groupId),
    parentArtifactId: str(project.parent?.artifactId),
    packaging: str(project.packaging) ?? 'jar',
    dependencies,
  };
}
