import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkMarketingMetadata } from '../scripts/check-marketing-metadata.mjs';

test('营销元数据与包、双语 README、外部分发文案及成功状态 CTA 一致', async () => {
  const metadata = await checkMarketingMetadata();
  assert.equal(metadata.github.topics.length, 20);
  assert.equal(new Set(metadata.github.topics).size, 20);
});
