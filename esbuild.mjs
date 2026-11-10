import { build } from 'esbuild';

// 扩展主包：CJS，vscode 外部化，其余（含 fast-xml-parser）全部打进 bundle
await build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  logLevel: 'info',
});

// 测试包：ESM，供 node 直接运行（node_modules 依赖保持 external）
await build({
  entryPoints: ['test/sanity.ts'],
  bundle: true,
  outfile: 'out/sanity.mjs',
  external: ['fast-xml-parser'],
  format: 'esm',
  platform: 'node',
  target: 'node18',
  sourcemap: false,
  logLevel: 'info',
});
