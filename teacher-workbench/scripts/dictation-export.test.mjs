import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../frontend/views/dictations.js', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('  const RETEST_PAGE_HEIGHT'), source.indexOf('  /** 生成名单画布'));
const { splitRetestPages, retestSectionHeight, RETEST_CONTENT_HEIGHT } = runInNewContext(
  `${helpers}\n({ splitRetestPages, retestSectionHeight, RETEST_CONTENT_HEIGHT })`
);

test('A4 分页保持分组及名单顺序，每页完整容纳所有行', () => {
  const sections = [
    { heading: '第一组', items: Array.from({ length: 83 }, (_, n) => ({ name: `A${n}` })) },
    { heading: '第二组', items: Array.from({ length: 9 }, (_, n) => ({ name: `B${n}` })) },
  ];
  const pages = splitRetestPages(sections);
  assert.ok(pages.length > 1);
  const items = pages.flatMap((page) => page.flatMap((section) => section.items.map((item) => item.name)));
  assert.deepEqual(Array.from(items), sections.flatMap((section) => section.items.map((item) => item.name)));
  for (const page of pages) {
    const height = page.reduce((sum, section) => sum + retestSectionHeight(section), 0) + (page.length - 1) * 26;
    assert.ok(height <= RETEST_CONTENT_HEIGHT);
  }
  for (const page of pages) {
    for (const part of page) {
      const original = sections.find((section) => section.heading === part.heading);
      assert.equal(part.items[0].name, original.items[part.offset].name);
    }
  }
});

test('空分组不产生空页，少量名单共用一页', () => {
  const pages = splitRetestPages([
    { heading: '空', items: [] },
    { heading: '一', items: [{ name: '张三' }] },
    { heading: '二', items: [{ name: '李四' }] },
  ]);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].length, 2);
  assert.equal(splitRetestPages([]).length, 0);
});
