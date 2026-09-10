const fs = require('node:fs');
const path = require('node:path');
const { patchRestoreProbe } = require('./readium-restore.cjs');

function replaceHook(source, hook, replacement) {
  if (!source.includes(hook)) {
    throw new Error('Readium selection hook changed; review the native paging patch.');
  }
  return source.replace(hook, replacement);
}

// Remove this patch when the pinned toolkit provides selection-aware paging.
function patchSelection(source) {
  const signature =
    '    func spreadView(_ spreadView: EPUBSpreadView, selectionDidChange text: Locator.Text?, frame: CGRect) {';
  const marker = '// Aldus: selection scroll lock.';
  if (source.includes(marker)) return source;

  // Migrate pods previously patched by the gesture-only workaround.
  source = source.replace(
    `${signature}
        // Aldus: selection handles must not turn pages.
        defer {
            if paginationView?.currentView === spreadView {
                let selecting = currentSelection != nil
                paginationView?.isScrollEnabled = !selecting && isPaginationViewScrollingEnabled
                spreadView.scrollView.isScrollEnabled = settings.scroll || !selecting
            }
        }`,
    signature,
  );
  source = replaceHook(
    source,
    signature,
    `${signature}
        ${marker}
        spreadView.setSelectionActive(text != nil)
        if paginationView?.currentView === spreadView {
            paginationView?.isScrollEnabled = text == nil && isPaginationViewScrollingEnabled
        }
`,
  );
  source = replaceHook(
    source,
    '(pageView as? EPUBSpreadView)?.webView.clearSelection()',
    '(pageView as? EPUBSpreadView)?.clearSelection()',
  );
  source = replaceHook(
    source,
    '    private var isPaginationViewScrollingEnabled: Bool {\n        !(config.disablePageTurnsWhileScrolling && settings.scroll)',
    `    private var isPaginationViewScrollingEnabled: Bool {
        (paginationView?.currentView as? EPUBSpreadView)?.isSelectingText != true
            && !(config.disablePageTurnsWhileScrolling && settings.scroll)`,
  );
  const jump =
    '        let success = await paginationView.goToIndex(spreadIndex, location: .locator(locator), options: options)';
  source = replaceHook(source, jump, `        clearSelection()\n\n${jump}`);
  return replaceHook(
    source,
    '        spreads = EPUBSpread.makeSpreads(',
    '        clearSelection()\n\n        spreads = EPUBSpread.makeSpreads(',
  );
}

function patchSpreadSelection(source) {
  const marker = '// Aldus: keep selection state local to its spread.';
  if (source.includes(marker)) return source;
  const property = '    private(set) var focusedResource: ReadingOrder.Index?';
  source = replaceHook(
    source,
    property,
    `${property}

    ${marker}
    private(set) var isSelectingText = false

    func setSelectionActive(_ active: Bool) {
        isSelectingText = active
    }

    func clearSelection() {
        if isSelectingText {
            setSelectionActive(false)
            delegate?.spreadView(self, selectionDidChange: nil, frame: .zero)
        }

        webView.clearSelection()
    }`,
  );
  return replaceHook(
    source,
    '    func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {\n        webView.clearSelection()',
    `    func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
        guard !isSelectingText || viewModel.scroll else {
            return
        }

        webView.clearSelection()`,
  );
}

function patchReflowableScrollLock(source) {
  const marker = '// Aldus: WebKit selection autoscroll bypasses isScrollEnabled.';
  if (source.includes(marker)) return source;
  const declaration = 'final class EPUBReflowableSpreadView: EPUBSpreadView {';
  source = replaceHook(
    source,
    declaration,
    `${declaration}
    ${marker}
    private var selectionScrollOffset: CGPoint?

    override func setSelectionActive(_ active: Bool) {
        super.setSelectionActive(active)

        if active && !viewModel.scroll {
            if selectionScrollOffset == nil {
                selectionScrollOffset = scrollView.contentOffset
            }
        } else {
            selectionScrollOffset = nil
        }
        scrollView.isScrollEnabled = viewModel.scroll || !active
    }
`,
  );
  for (const signature of [
    '    private func updateContentInset() {',
    '    override func go(to direction: EPUBSpreadView.Direction, options: NavigatorGoOptions) async -> Bool {',
    '    override func go(to location: PageLocation) async {',
  ]) {
    source = replaceHook(
      source,
      signature,
      `${signature}
        if isSelectingText {
            clearSelection()
        }
`,
    );
  }
  for (const signature of [
    '    private func progressionDidChange(_ body: Any) {',
    '    @objc private func notifyPagesDidChange() {',
  ]) {
    source = replaceHook(
      source,
      signature,
      `${signature}
        guard selectionScrollOffset == nil else {
            return
        }
`,
    );
  }
  const scrollHook = '    override func scrollViewDidScroll(_ scrollView: UIScrollView) {';
  return replaceHook(
    source,
    scrollHook,
    `${scrollHook}
        if let offset = selectionScrollOffset {
            if scrollView.contentOffset != offset {
                scrollView.setContentOffset(offset, animated: false)
            }
            return
        }
`,
  );
}

function patchReflowableSelection(source) {
  const marker = '// Aldus: bottom-edge selection preview.';
  const appendix = '// Aldus: selection gesture implementation.';
  const gesture = fs.readFileSync(path.join(__dirname, 'readium-selection-gesture.swift'), 'utf8');
  if (source.includes(marker)) {
    if (!source.includes(appendix)) {
      throw new Error(
        'Readium selection gesture implementation is missing; reinstall the toolkit pod.',
      );
    }
    return `${source.slice(0, source.indexOf(appendix)).trimEnd()}\n\n${appendix}\n${gesture}`;
  }

  source = patchReflowableScrollLock(source);
  source = replaceHook(
    source,
    '    private var selectionScrollOffset: CGPoint?',
    `    ${marker}
    private var selectionScrollOffset: CGPoint?
    private var selectionOriginalOffset: CGPoint?
    private var selectionEdgeGesture: AldusSelectionEdgeGestureRecognizer?
    private var selectionRestoreGeneration = 0
    private var selectionRestorePending: Int?
    private var selectionRestoreTask: Task<Void, Never>?

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window == nil {
            selectionEdgeGesture?.cancelTracking()
            selectionRestoreTask?.cancel()
            selectionRestorePending = nil
        }
    }

    override func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
        if !isSelectingText {
            selectionRestoreTask?.cancel()
            selectionRestorePending = nil
        }
        super.scrollViewWillBeginDragging(scrollView)
    }`,
  );
  source = replaceHook(
    source,
    '                selectionScrollOffset = scrollView.contentOffset',
    `                selectionRestoreTask?.cancel()
                selectionRestorePending = nil
                selectionOriginalOffset = scrollView.contentOffset
                selectionScrollOffset = scrollView.contentOffset`,
  );
  source = replaceHook(
    source,
    '        } else {\n            selectionScrollOffset = nil\n        }\n        scrollView.isScrollEnabled',
    `        } else {
            selectionEdgeGesture?.cancelTracking()
            restoreSelectionPage()
            selectionOriginalOffset = nil
            selectionScrollOffset = nil
        }
        scrollView.isScrollEnabled`,
  );
  source = replaceHook(
    source,
    '    override func setupWebView() {\n        super.setupWebView()',
    `    override func setupWebView() {
        super.setupWebView()

        let observer = AldusSelectionEdgeGestureRecognizer(spread: self)
        selectionEdgeGesture = observer
        addGestureRecognizer(observer)`,
  );
  for (const signature of [
    '    private func updateContentInset() {',
    '    override func go(to direction: EPUBSpreadView.Direction, options: NavigatorGoOptions) async -> Bool {',
    '    override func go(to location: PageLocation) async {',
  ]) {
    const hook = `${signature}\n        if isSelectingText {\n            clearSelection()\n        }`;
    source = replaceHook(
      source,
      hook,
      `${hook}
        selectionRestoreTask?.cancel()
        selectionRestorePending = nil`,
    );
  }
  source = source.replaceAll(
    '        guard selectionScrollOffset == nil else {',
    '        guard selectionScrollOffset == nil, selectionRestorePending == nil else {',
  );
  source = replaceHook(
    source,
    '    override func registerJSMessages() {\n        super.registerJSMessages()',
    `    override func registerJSMessages() {
        super.registerJSMessages()
        registerJSMessage(named: "aldusSelectionRestored") { [weak self] body in
            guard let self, let generation = body as? Int,
                  self.selectionRestorePending == generation
            else {
                return
            }

            self.selectionRestorePending = nil
        }`,
  );
  return `${source.trimEnd()}\n\n${appendix}\n${gesture}`;
}

function patchEdgeTaps(source) {
  const signature =
    '    private func onTap(at point: CGPoint, in navigator: VisualNavigator) async -> Bool {';
  const marker = '// Aldus: selection taps belong to the text controls.';
  if (source.includes(marker)) return source;
  return replaceHook(
    source,
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
  const updates = [
    ['Sources/Navigator/EPUB/Assets/Static/scripts/readium-reflowable.js', patchRestoreProbe],
    ['Sources/Navigator/EPUB/Assets/Static/scripts/readium-fixed.js', patchRestoreProbe],
    ['Sources/Navigator/EPUB/EPUBNavigatorViewController.swift', patchSelection],
    ['Sources/Navigator/EPUB/EPUBSpreadView.swift', patchSpreadSelection],
    ['Sources/Navigator/EPUB/EPUBReflowableSpreadView.swift', patchReflowableSelection],
    ['Sources/Navigator/DirectionalNavigationAdapter.swift', patchEdgeTaps],
  ].map(([relativePath, patch]) => {
    const file = path.join(root, relativePath);
    const source = fs.readFileSync(file, 'utf8');
    return { file, source, next: patch(source) };
  });
  for (const { file, source, next } of updates) {
    if (source === next) continue;
    fs.chmodSync(file, fs.statSync(file).mode | 0o200);
    fs.writeFileSync(file, next);
  }
  console.log('Aldus: selection scroll lock and bottom-edge page preview applied');
}

module.exports = {
  patchSelection,
  patchSpreadSelection,
  patchReflowableSelection,
  patchEdgeTaps,
};
