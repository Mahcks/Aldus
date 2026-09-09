const fs = require('node:fs');
const path = require('node:path');

// Readium 3.5 lets its paging scroll views compete with text-selection handles.
// Remove this patch when the pinned toolkit provides selection-aware paging.
function patchSelection(source) {
  const signature =
    '    func spreadView(_ spreadView: EPUBSpreadView, selectionDidChange text: Locator.Text?, frame: CGRect) {';
  const marker = '// Aldus: selection handles must not turn pages.';
  if (source.includes(marker)) return source;
  if (!source.includes(signature))
    throw new Error('Readium selection hook changed; review the native paging patch.');

  return source.replace(
    signature,
    `${signature}
        ${marker}
        defer {
            if paginationView?.currentView === spreadView {
                let selecting = currentSelection != nil
                paginationView?.isScrollEnabled = !selecting && isPaginationViewScrollingEnabled
                spreadView.scrollView.isScrollEnabled = settings.scroll || !selecting
            }
        }`,
  );
}

function patchEdgeTaps(source) {
  const signature =
    '    private func onTap(at point: CGPoint, in navigator: VisualNavigator) async -> Bool {';
  const marker = '// Aldus: selection taps belong to the text controls.';
  if (source.includes(marker)) return source;
  if (!source.includes(signature))
    throw new Error('Readium tap hook changed; review the native paging patch.');

  return source.replace(
    signature,
    `${signature}
        ${marker}
        if let selectable = navigator as? SelectableNavigator, selectable.currentSelection != nil {
            return true
        }
`,
  );
}

if (require.main === module) {
  const root = process.argv[2];
  for (const [relativePath, patch] of [
    ['Sources/Navigator/EPUB/EPUBNavigatorViewController.swift', patchSelection],
    ['Sources/Navigator/DirectionalNavigationAdapter.swift', patchEdgeTaps],
  ]) {
    const file = path.join(root, relativePath);
    const source = fs.readFileSync(file, 'utf8');
    const next = patch(source);
    if (source === next) continue;
    fs.chmodSync(file, fs.statSync(file).mode | 0o200);
    fs.writeFileSync(file, next);
  }
}

module.exports = { patchSelection, patchEdgeTaps };
