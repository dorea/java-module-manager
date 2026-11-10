import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parsePom } from '../src/lib/pom';
import { scanRoots } from '../src/lib/scan';
import { buildGraph } from '../src/lib/depgraph';
import { DEFAULT_EXCLUSIONS, isModuleExcluded, managedPatterns, mergeExclusions } from '../src/lib/exclusions';

const tests: { name: string; fn: () => void | Promise<void> }[] = [];
function test(name: string, fn: () => void | Promise<void>): void {
  tests.push({ name, fn });
}

// ---------- parsePom ----------
test('parsePom: parent / dependencies / comments / inherited groupId', () => {
  const xml = `<?xml version="1.0"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <!-- a comment -->
  <parent>
    <groupId>com.example.corp</groupId>
    <artifactId>example-dependency-parent</artifactId>
    <version>1.0.0-SNAPSHOT</version>
  </parent>
  <modelVersion>4.0.0</modelVersion>
  <artifactId>app-a</artifactId>
  <packaging>jar</packaging>
  <dependencyManagement>
    <dependencies>
      <dependency><groupId>com.example.corp</groupId><artifactId>lib-b</artifactId></dependency>
    </dependencies>
  </dependencyManagement>
  <dependencies>
    <dependency><groupId>com.example.corp</groupId><artifactId>common-starter</artifactId></dependency>
    <dependency><groupId>com.example.corp</groupId><artifactId>lib-b</artifactId></dependency>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>
  </dependencies>
</project>`;
  const p = parsePom(xml)!;
  assert.ok(p, 'parse result should not be empty');
  assert.equal(p.artifactId, 'app-a');
  assert.equal(p.groupId, undefined);
  assert.equal(p.parentGroupId, 'com.example.corp');
  assert.equal(p.packaging, 'jar');
  assert.equal(p.dependencies.length, 3, 'only <dependencies>, not dependencyManagement');
});

test('parsePom: invalid XML returns undefined', () => {
  assert.equal(parsePom('<project><artifactId>x'), undefined);
  assert.equal(parsePom('<foo/>'), undefined);
});

// ---------- scanRoots ----------
test('scanRoots: finds modules, skips target/node_modules, handles nested modules', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jmm-'));
  const mk = (rel: string, artifactId: string, deps = '') => {
    const dir = path.join(root, rel);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'pom.xml'),
      `<project><groupId>g</groupId><artifactId>${artifactId}</artifactId>${deps}</project>`,
    );
  };
  mk('app-a', 'app-a', '<dependencies><dependency><groupId>g</groupId><artifactId>lib-b</artifactId></dependency></dependencies>');
  mk('lib-b', 'lib-b');
  mk('sub/nested-c', 'nested-c');
  mk('node_modules/bad', 'bad'); // should be skipped
  mk('target/bad2', 'bad2'); // should be skipped

  const modules = scanRoots([root], 5);
  const folders = modules.map((m) => m.folder).sort();
  assert.deepEqual(folders, ['app-a', 'lib-b', 'sub/nested-c']);
  const a = modules.find((m) => m.folder === 'app-a')!;
  assert.equal(a.artifactId, 'app-a');
  assert.equal(a.groupId, 'g');
  assert.deepEqual(a.deps, ['g:lib-b']);

  const g = buildGraph(modules);
  assert.deepEqual([...g.depsOf('app-a')].sort(), ['app-a', 'lib-b']);
  assert.deepEqual([...g.dependentsOf('lib-b')], ['app-a']);
  assert.deepEqual([...g.closure(['app-a'])].sort(), ['app-a', 'lib-b']);
});

test('buildGraph: transitive closure and dependents', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jmm-'));
  const mk = (rel: string, artifactId: string, depArtifacts: string[] = []) => {
    const dir = path.join(root, rel);
    fs.mkdirSync(dir, { recursive: true });
    const deps = depArtifacts
      .map((d) => `<dependency><groupId>g</groupId><artifactId>${d}</artifactId></dependency>`)
      .join('');
    fs.writeFileSync(
      path.join(dir, 'pom.xml'),
      `<project><groupId>g</groupId><artifactId>${artifactId}</artifactId><dependencies>${deps}</dependencies></project>`,
    );
  };
  mk('svc', 'svc', ['mid']);
  mk('mid', 'mid', ['base']);
  mk('base', 'base');
  mk('other', 'other');

  const modules = scanRoots([root], 5);
  const g = buildGraph(modules);
  assert.deepEqual([...g.closure(['svc'])].sort(), ['base', 'mid', 'svc']);
  assert.deepEqual([...g.dependentsOf('base')], ['mid']);
  assert.deepEqual([...g.closure(['other'])], ['other']);
});

// ---------- exclusions ----------
test('mergeExclusions: keeps user rules, replaces managed entries, ensures defaults', () => {
  const allFolders = ['app-a', 'lib-b', 'sub/nested-c'];
  // current state: app-a closed (managed pair) plus a user-written rule
  const current = [...DEFAULT_EXCLUSIONS, ...managedPatterns('app-a'), '**/Frontend/**'];
  assert.ok(isModuleExcluded(current, 'app-a'));
  assert.ok(!isModuleExcluded(current, 'lib-b'));

  // switch to closing only lib-b
  const next = mergeExclusions(current, ['lib-b'], allFolders);
  assert.deepEqual(
    next,
    [...DEFAULT_EXCLUSIONS, '**/Frontend/**', ...managedPatterns('lib-b')],
    'app-a managed entries removed, custom rule kept, defaults present',
  );
  assert.ok(!isModuleExcluded(next, 'app-a'));
  assert.ok(isModuleExcluded(next, 'lib-b'));

  // user accidentally deleted defaults -> restored
  const next2 = mergeExclusions(['**/x/**'], ['app-a'], allFolders);
  for (const d of DEFAULT_EXCLUSIONS) assert.ok(next2.includes(d));
});

// ---------- optional smoke test on a real repository ----------
// Set JMM_SMOKE_REPO=/path/to/maven/multi-module/project to run it.
test('smoke: scan a real repository (JMM_SMOKE_REPO)', () => {
  const root = process.env.JMM_SMOKE_REPO;
  if (!root) {
    console.log('  (skipped: JMM_SMOKE_REPO not set)');
    return;
  }
  assert.ok(fs.existsSync(root), `JMM_SMOKE_REPO does not exist: ${root}`);
  const modules = scanRoots([root], 5);
  assert.ok(modules.length > 0, 'should find at least one module');
  console.log(`  found ${modules.length} module(s):`);
  for (const m of modules.sort((a, b) => a.folder.localeCompare(b.folder))) {
    console.log(`    ${m.folder.padEnd(32)} ${m.groupId}:${m.artifactId} [${m.packaging}]`);
  }
});

// ---------- runner ----------
(async () => {
  let pass = 0;
  let fail = 0;
  for (const t of tests) {
    try {
      await t.fn();
      pass++;
      console.log(`PASS ${t.name}`);
    } catch (e) {
      fail++;
      console.error(`FAIL ${t.name}`);
      console.error(e);
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    process.exit(1);
  }
})();
