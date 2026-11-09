const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

// Inspect the effective policy returned for both projects without loading Next,
// installing packages, opening a database, or executing third-party ESM code.
async function projects() {
  const filename = path.join(__dirname, '..', 'jest.config.js');
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    require(name) {
      assert.equal(name, 'next/jest');
      return () => config => async () => ({
        ...config,
        transformIgnorePatterns: ['/node_modules/'],
      });
    },
  }, { filename });
  return (await module.exports()).projects;
}

for (const projectName of ['unit', 'database']) {
  test(`${projectName}: transforms the exact ESM-only TanStack package graph`, async () => {
    const project = (await projects()).find(p => p.displayName === projectName);
    assert.ok(project);
    for (const name of ['react-table', 'table-core', 'react-store', 'store']) {
      const filename = `/repo/node_modules/@tanstack/${name}/dist/index.js`;
      assert.equal(project.transformIgnorePatterns.some(p => new RegExp(p).test(filename)), false, name);
    }
  });

  test(`${projectName}: preserves existing transforms and unrelated ignores`, async () => {
    const project = (await projects()).find(p => p.displayName === projectName);
    const ignored = file => project.transformIgnorePatterns.some(p => new RegExp(p).test(file));
    for (const name of ['d3-geo', 'd3-selection', 'internmap']) {
      assert.equal(ignored(`/repo/node_modules/${name}/src/index.js`), false, name);
    }
    assert.equal(ignored('/repo/node_modules/lodash/index.js'), true);
    assert.equal(ignored('/repo/node_modules/@tanstack/unrelated/index.js'), true);
    assert.equal(ignored('/repo/components/table.module.css'), true);
  });
}

test('database tests retain their isolated serial project boundary', async () => {
  const all = await projects();
  const unit = all.find(p => p.displayName === 'unit');
  const database = all.find(p => p.displayName === 'database');
  assert.ok(unit.testPathIgnorePatterns.some(p => new RegExp(p).test('/repo/a.database.test.ts')));
  assert.equal(database.globalSetup, '<rootDir>/jest.database-setup.js');
  assert.deepEqual(Array.from(database.testMatch), ['**/*.database.test.?(ts|tsx|js|jsx)']);
});
