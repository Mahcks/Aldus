import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { signInAsTestAdmin, testServer } from './auth';

const markerURL = `${testServer}/api/v1/epub-security-marker`;

function hostileEPUB() {
  const chapter = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <title>Security marker</title>
    <meta http-equiv="refresh" content="60; url=${markerURL}" />
    <link rel="stylesheet" href="style.css" />
    <style>body { background-image: u\\72l('${markerURL}?css=1'); }</style>
  </head>
  <body onload="parent.document.documentElement.dataset.epubEvent = 'ran'">
    <h1>Harmless EPUB security marker</h1>
    <script>
      parent.document.documentElement.dataset.epubScript = 'ran';
      fetch(${JSON.stringify(markerURL)}, { credentials: 'include' });
    </script>
    <img src="missing.png" alt="" onerror="parent.document.documentElement.dataset.epubError = 'ran'" />
    <iframe srcdoc="&lt;script&gt;parent.postMessage('epub-frame-ran', '*')&lt;/script&gt;"></iframe>
    <object data="${markerURL}?object=1"></object>
    <svg xmlns="http://www.w3.org/2000/svg" onload="parent.postMessage('epub-svg-ran', '*')">
      <script>parent.postMessage('epub-svg-script-ran', '*')</script>
      <image href="${markerURL}?svg=1" />
      <rect width="10" height="10" fill="u\\72l('${markerURL}?svg-paint=1')" />
      <animate attributeName="href" values="${markerURL}?svg-animation=1" />
    </svg>
    <a href="javascript:parent.postMessage('epub-link-ran', '*')">Unsafe marker link</a>
  </body>
</html>`;
  const script = String.raw`
import io, sys, zipfile

chapter, stylesheet = sys.argv[1:]
files = {
    "META-INF/container.xml": """<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="EPUB/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>""",
    "EPUB/content.opf": """<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">aldus-security-marker</dc:identifier>
    <dc:title>EPUB Security Marker</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-09-04T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="style" href="style.css" media-type="text/css"/>
  </manifest>
  <spine><itemref idref="chapter"/></spine>
</package>""",
    "EPUB/nav.xhtml": """<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Contents</title></head>
<body><nav xmlns:epub="http://www.idpf.org/2007/ops" epub:type="toc"><ol><li><a href="chapter.xhtml">Marker</a></li></ol></nav></body></html>""",
    "EPUB/chapter.xhtml": chapter,
    "EPUB/style.css": stylesheet,
}

output = io.BytesIO()
with zipfile.ZipFile(output, "w") as archive:
    archive.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
    for name, data in files.items():
        archive.writestr(name, data, compress_type=zipfile.ZIP_DEFLATED)
sys.stdout.buffer.write(output.getvalue())
`;
  const stylesheet = `h1 { color: maroon; background-image: u\\72l('${markerURL}?linked-css=1'); }`;
  return execFileSync('python3', ['-c', script, chapter, stylesheet]);
}

test('book-authored active content cannot escape the web reader', async ({ page }) => {
  const markerRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith(markerURL)) markerRequests.push(request.url());
  });
  await page.addInitScript(() => {
    window.addEventListener('message', (event) => {
      if (typeof event.data === 'string' && event.data.startsWith('epub-')) {
        document.documentElement.dataset.epubMessage = event.data;
      }
    });
  });
  await signInAsTestAdmin(page);

  const libraryResponse = await page.request.post(`${testServer}/api/v1/libraries`, {
    data: { name: 'EPUB Security Test' },
  });
  expect(libraryResponse.ok()).toBe(true);
  const library = (await libraryResponse.json()) as { id: string };

  const workResponse = await page.request.post(
    `${testServer}/api/v1/libraries/${library.id}/works`,
    { data: { title: 'Harmless EPUB Security Marker', author: 'Aldus Tests' } },
  );
  expect(workResponse.ok()).toBe(true);
  const work = (await workResponse.json()) as { id: string };

  const representationResponse = await page.request.post(
    `${testServer}/api/v1/works/${work.id}/representations`,
    { data: { kind: 'epub', label: 'Security fixture' } },
  );
  expect(representationResponse.ok()).toBe(true);
  const representation = (await representationResponse.json()) as { id: string };

  const mediaResponse = await page.request.post(
    `${testServer}/api/v1/libraries/${library.id}/representations/${representation.id}/media`,
    {
      multipart: {
        file: {
          name: 'security-marker.epub',
          mimeType: 'application/epub+zip',
          buffer: hostileEPUB(),
        },
      },
    },
  );
  expect(mediaResponse.ok()).toBe(true);
  const media = (await mediaResponse.json()) as { id: string };

  await page.goto(`/consume/${work.id}?mode=read&epub=${media.id}`);
  await expect(page.getByRole('button', { name: 'Open reader settings' })).toBeVisible({
    timeout: 30_000,
  });
  await expect
    .poll(() =>
      page.locator('foliate-view').evaluate((element) => {
        const view = element as HTMLElement & {
          renderer?: { getContents: () => { doc: Document }[] };
        };
        const doc = view.renderer?.getContents()[0]?.doc;
        const heading = doc?.querySelector('h1');
        if (!doc || !heading) return null;
        const elements = Array.from(doc.querySelectorAll('*'));
        return {
          activeElements: doc.querySelectorAll(
            'script, iframe, object, embed, animate, animateMotion, animateTransform, set',
          ).length,
          eventAttributes: elements
            .flatMap((node) => Array.from(node.attributes))
            .filter((attr) => attr.localName.toLowerCase().startsWith('on')).length,
          externalReferences: elements
            .flatMap((node) => Array.from(node.attributes))
            .filter((attr) => ['href', 'poster', 'src'].includes(attr.localName.toLowerCase()))
            .filter((attr) => attr.value.includes('epub-security-marker')).length,
          heading: heading.textContent,
          headingColor: doc.defaultView?.getComputedStyle(heading).color,
          unsafeLink: doc.querySelector('a')?.getAttribute('href') ?? null,
        };
      }),
    )
    .toEqual({
      activeElements: 0,
      eventAttributes: 0,
      externalReferences: 0,
      heading: 'Harmless EPUB security marker',
      headingColor: 'rgb(128, 0, 0)',
      unsafeLink: null,
    });
  await page.waitForTimeout(500);

  await expect
    .poll(() =>
      page.evaluate(() => ({
        event: document.documentElement.dataset.epubEvent,
        script: document.documentElement.dataset.epubScript,
        error: document.documentElement.dataset.epubError,
        message: document.documentElement.dataset.epubMessage,
      })),
    )
    .toEqual({ event: undefined, script: undefined, error: undefined, message: undefined });
  expect(markerRequests).toEqual([]);
});
