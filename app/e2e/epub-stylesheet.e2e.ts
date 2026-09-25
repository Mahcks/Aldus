import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import ts from 'typescript';

const source = ts.transpileModule(
  readFileSync('src/components/consumption/reader/epub-security.ts', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

test('EPUB namespace styles survive sanitizing without allowing external resources', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  const results = await page.evaluate(async (source) => {
    const exports = {} as {
      installEPUBContentSecurity: (book: { transformTarget: EventTarget }) => void;
    };
    new Function('exports', source)(exports);
    const transformTarget = new EventTarget();
    exports.installEPUBContentSecurity({ transformTarget });
    const css = `@namespace url("http://www.w3.org/1999/xhtml");
      @namespace svg url("http://www.w3.org/2000/svg");
      p { color: maroon; background-image: url("https://blocked.invalid/image.png"); }
      svg|text { fill: green; }
      @media screen { p { background: url("https://blocked.invalid/nested.png"); } }`;
    const results: string[] = [];
    for (const type of ['text/css', 'application/xhtml+xml']) {
      const detail = {
        type,
        data:
          type === 'text/css'
            ? css
            : `<html xmlns="http://www.w3.org/1999/xhtml"><head><style>${css}</style></head><body><p>Next chapter</p></body></html>`,
      };
      transformTarget.dispatchEvent(new CustomEvent('data', { detail }));
      results.push(await detail.data);
    }
    return results;
  }, source);
  for (const result of results) {
    expect(result).toContain('@namespace');
    expect(result).toContain('svg|text');
    expect(result).toContain('maroon');
    expect(result).not.toContain('blocked.invalid');
  }
  expect(results[1]).toContain('Next chapter');
  expect(requests).toEqual([]);
});
