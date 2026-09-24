import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minYears, parseDataPage, usEligible, ycLocationSlug } from '../../mcp/src/sources/yc.ts';
import { DEFAULT_CONFIG, scoreJob } from '../src/index.ts';

test('the embedded page data is decoded', () => {
  const html = '<div data-page="{&quot;component&quot;:&quot;X&quot;,&quot;props&quot;:{&quot;jobPostings&quot;:[{&quot;id&quot;:1,&quot;title&quot;:&quot;Strategy &amp; Ops&quot;,&quot;companyName&quot;:&quot;Acme&#39;s&quot;}]}}"></div>';
  const props = parseDataPage(html) as { jobPostings: { title: string; companyName: string }[] };
  assert.equal(props.jobPostings[0].title, 'Strategy & Ops');
  assert.equal(props.jobPostings[0].companyName, "Acme's");
  assert.equal(parseDataPage('<html>nothing here</html>'), null);
});

test('target city names map to YC location slugs', () => {
  assert.equal(ycLocationSlug('New York City'), 'new-york');
  assert.equal(ycLocationSlug('San Francisco'), 'san-francisco');
  assert.equal(ycLocationSlug('Boston'), 'boston');
});

test('remote roles restricted to another country are not US-eligible', () => {
  assert.ok(usEligible('New York, NY, US'));
  assert.ok(usEligible('Remote (US)'));
  assert.ok(usEligible('Remote'));
  assert.ok(usEligible('HQ - San Francisco, CA / Remote (US)'));
  assert.ok(usEligible('San Francisco, CA, US / Remote (London, England, GB)'), 'one US option is enough');
  assert.ok(!usEligible('Remote (IN; Pune, MH, IN; Bengaluru, KA, IN)'));
  assert.ok(!usEligible('Munich, BY, DE / Munich, Bavaria, DE'));
  assert.ok(!usEligible('London, England, GB'));
});

test('YC\'s stated minimum experience is read exactly', () => {
  assert.equal(minYears('Any (new grads ok)'), 0);
  assert.equal(minYears('3+ years'), 3);
  assert.equal(minYears('6+ years'), 6);
  assert.equal(minYears(null), null);
  assert.equal(minYears('null'), null);
});

test('common BizOps titles route to the BizOps archetype', () => {
  for (const title of ['Strategy & Operations', 'BizOps Associate', 'Founders Associate',
    "Founder's Associate", 'Strategic Projects Associate', 'Strategy and Operations Associate']) {
    const r = scoreJob(DEFAULT_CONFIG, { title, company: 'Acme', location: 'Boston, MA', jd: null });
    assert.equal(r.archetype, 4, title);
    assert.equal(r.needs_jd, true, `${title} is held for its JD, not dropped`);
  }
});
