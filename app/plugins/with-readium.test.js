const { describe, expect, test } = require('bun:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { patchPodfile } = require('./with-readium');
const {
  patchSelection,
  patchSpreadSelection,
  patchReflowableSelection,
  patchEdgeTaps,
} = require('./readium-selection.cjs');

const podfile = `require 'react-native/scripts/react_native_pods'

target 'Aldus' do
  use_expo_modules!

  post_install do |installer|
    react_native_post_install(installer)
  end
end
`;

// Relevant unmodified Readium 3.5 navigation hooks shared by the patch fixtures.
const navigationHooks = `
    private var isPaginationViewScrollingEnabled: Bool {
        !(config.disablePageTurnsWhileScrolling && settings.scroll)
    }
        spreads = EPUBSpread.makeSpreads(
        let success = await paginationView.goToIndex(spreadIndex, location: .locator(locator), options: options)
`;

describe('Readium config plugin', () => {
  test('replaces the old gesture-only patch in existing Pods', () => {
    const source = `    func spreadView(_ spreadView: EPUBSpreadView, selectionDidChange text: Locator.Text?, frame: CGRect) {
        // Aldus: selection handles must not turn pages.
        defer {
            if paginationView?.currentView === spreadView {
                let selecting = currentSelection != nil
                paginationView?.isScrollEnabled = !selecting && isPaginationViewScrollingEnabled
                spreadView.scrollView.isScrollEnabled = settings.scroll || !selecting
            }
        }
    }
    (pageView as? EPUBSpreadView)?.webView.clearSelection()`;
    const patched = patchSelection(source + navigationHooks);
    expect(patched).not.toContain('let selecting = currentSelection != nil');
    expect(patched).toContain('spreadView.setSelectionActive(text != nil)');
    expect(patchSelection(patched)).toBe(patched);
  });

  test('patches local selection, offset locking, and both progression callbacks', () => {
    const spread = `    private(set) var focusedResource: ReadingOrder.Index?
    func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
        webView.clearSelection()
    }`;
    const reflowable = `final class EPUBReflowableSpreadView: EPUBSpreadView {
    private func updateContentInset() {
    }
    override func go(to direction: EPUBSpreadView.Direction, options: NavigatorGoOptions) async -> Bool {
    }
    override func go(to location: PageLocation) async {
    }
    private func progressionDidChange(_ body: Any) {
    }
    @objc private func notifyPagesDidChange() {
    }
    override func scrollViewDidScroll(_ scrollView: UIScrollView) {
        super.scrollViewDidScroll(scrollView)
    }
}`;
    const patchedSpread = patchSpreadSelection(spread);
    const patchedReflowable = patchReflowableSelection(reflowable);
    expect(patchSpreadSelection(patchedSpread)).toBe(patchedSpread);
    expect(patchReflowableSelection(patchedReflowable)).toBe(patchedReflowable);
    expect(patchedSpread).toContain('guard !isSelectingText || viewModel.scroll else');
    expect(patchedReflowable).toContain('if active && !viewModel.scroll');
    expect(patchedReflowable).toContain('if selectionScrollOffset == nil');
    expect(patchedReflowable.match(/guard selectionScrollOffset == nil else/g)).toHaveLength(2);
    expect(
      patchedReflowable.indexOf('scrollView.setContentOffset(offset, animated: false)'),
    ).toBeLessThan(patchedReflowable.indexOf('super.scrollViewDidScroll(scrollView)'));
    expect(() => patchSpreadSelection('changed upstream')).toThrow('selection hook changed');
    expect(() => patchReflowableSelection('changed upstream')).toThrow('selection hook changed');
  });

  test('patches native selection paging once and rejects changed toolkit hooks', () => {
    const selection =
      '    func spreadView(_ spreadView: EPUBSpreadView, selectionDidChange text: Locator.Text?, frame: CGRect) {\n        viewModel.editingActions.selection = nil\n    }\n(pageView as? EPUBSpreadView)?.webView.clearSelection()';
    const tap =
      '    private func onTap(at point: CGPoint, in navigator: VisualNavigator) async -> Bool {\n        return false\n    }';
    const patchedSelection = patchSelection(selection + navigationHooks);
    const patchedTap = patchEdgeTaps(tap);

    expect(patchSelection(patchedSelection)).toBe(patchedSelection);
    expect(patchEdgeTaps(patchedTap)).toBe(patchedTap);
    expect(patchedSelection).toContain('paginationView?.currentView === spreadView');
    expect(patchedSelection).toContain('spreadView.setSelectionActive(text != nil)');
    expect(patchedSelection).toContain('(pageView as? EPUBSpreadView)?.clearSelection()');
    expect(patchedTap).toContain('selectable.currentSelection != nil');
    expect(() => patchSelection('changed upstream')).toThrow('selection hook changed');
    expect(() => patchEdgeTaps('changed upstream')).toThrow('selection hook changed');
  });

  test('adds the required sources, pods, and post-install hook once', () => {
    const patched = patchPodfile(podfile);
    expect(patched).toContain("source 'https://github.com/readium/podspecs'");
    expect(patched).toContain("require_relative '../plugins/readium_post_install'");
    expect(patched).not.toContain("react-native-readium/scripts/readium_post_install'");
    expect(patched).toContain('  readium_pods');
    expect(patched).toContain('    aldus_readium_post_install(installer)');
    expect(patchPodfile(patched)).toBe(patched);
  });

  test('migrates the broken RC 17 upstream post-install hook', () => {
    const old = patchPodfile(podfile).replace(
      "require_relative '../plugins/readium_post_install'",
      "require_relative '../node_modules/react-native-readium/scripts/readium_post_install'",
    );
    expect(patchPodfile(old)).toContain("require_relative '../plugins/readium_post_install'");
    expect(patchPodfile(old)).toContain('    aldus_readium_post_install(installer)');
  });

  test('keeps the patched iOS locator method outside destroy', () => {
    const swift = readFileSync(
      join(__dirname, '../node_modules/react-native-readium/ios/HybridReadiumView.swift'),
      'utf8',
    );
    expect(swift.indexOf('func currentVisibleLocation()')).toBeLessThan(
      swift.indexOf('func destroy()'),
    );
    expect(swift).toContain('NodeFilter.SHOW_TEXT');
    expect(swift).toContain('navigator.currentLocation');
    expect(swift.match(/addChild\(readerViewController!\)/g)).toHaveLength(1);
  });
});
