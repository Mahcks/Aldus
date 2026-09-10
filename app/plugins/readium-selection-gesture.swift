// Appended to EPUBReflowableSpreadView.swift so it belongs to the existing Pods target.
import Foundation

enum AldusSelectionPaging {
    static func isBottomEdge(_ point: CGPoint, viewport: CGRect) -> Bool {
        viewport.width > 0 && viewport.height > 0
            && point.x >= viewport.minX && point.x <= viewport.maxX
            && point.y >= max(viewport.minY, viewport.maxY - 44)
            && point.y <= viewport.maxY
    }

    static func nextOffset(
        current: CGFloat,
        width: CGFloat,
        contentWidth: CGFloat,
        rightToLeft: Bool
    ) -> CGFloat? {
        guard width > 0, current.isFinite, width.isFinite, contentWidth.isFinite,
              current >= 0, current + width <= contentWidth
        else {
            return nil
        }

        let direction: CGFloat = rightToLeft ? -1 : 1
        let next = (round(current / width) + direction) * width
        guard next >= 0, next + width <= contentWidth else {
            return nil
        }

        return next
    }
}

#if canImport(UIKit)
import UIKit.UIGestureRecognizerSubclass

private final class AldusSelectionEdgeGestureRecognizer: UIGestureRecognizer {
    private weak var spread: EPUBReflowableSpreadView?
    private var trackedTouch: UITouch?
    private var startPoint = CGPoint.zero
    private var hasMoved = false
    private var isAtBottomEdge = false
    private var dwellTimer: Timer?

    init(spread: EPUBReflowableSpreadView) {
        self.spread = spread
        super.init(target: nil, action: nil)

        cancelsTouchesInView = false
        delaysTouchesBegan = false
        delaysTouchesEnded = false
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(cancelTracking),
            name: UIApplication.willResignActiveNotification,
            object: nil
        )
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    deinit {
        dwellTimer?.invalidate()
        NotificationCenter.default.removeObserver(self)
    }

    // Observe native selection touches without winning or losing against WebKit.
    override func canPrevent(_ preventedGestureRecognizer: UIGestureRecognizer) -> Bool {
        false
    }

    override func canBePrevented(by preventingGestureRecognizer: UIGestureRecognizer) -> Bool {
        false
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        guard trackedTouch == nil, touches.count == 1, let touch = touches.first else {
            cancelTracking()
            state = .failed
            return
        }

        trackedTouch = touch
        startPoint = touch.location(in: spread)
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        guard let spread, let touch = trackedTouch, touches.contains(touch) else {
            return
        }

        let point = touch.location(in: spread)
        if hypot(point.x - startPoint.x, point.y - startPoint.y) >= 8 {
            hasMoved = true
        }

        let atEdge = hasMoved
            && spread.isSelectingText
            && !spread.viewModel.scroll
            && AldusSelectionPaging.isBottomEdge(point, viewport: spread.webView.frame)

        guard atEdge else {
            dwellTimer?.invalidate()
            dwellTimer = nil
            isAtBottomEdge = false
            return
        }
        guard !isAtBottomEdge else {
            return
        }

        isAtBottomEdge = true
        let timer = Timer(timeInterval: 0.5, repeats: false) { [weak self] _ in
            guard let self, self.trackedTouch != nil, self.isAtBottomEdge else {
                return
            }

            self.dwellTimer = nil
            self.spread?.advanceSelectionPage()
        }
        dwellTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        cancelTracking()
        state = .failed
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
        cancelTracking()
        state = .failed
    }

    override func reset() {
        super.reset()
        cancelTracking()
    }

    @objc func cancelTracking() {
        dwellTimer?.invalidate()
        dwellTimer = nil
        trackedTouch = nil
        hasMoved = false
        isAtBottomEdge = false
    }
}

fileprivate extension EPUBReflowableSpreadView {
    func restoreSelectionPage() {
        guard let original = selectionOriginalOffset,
              let current = selectionScrollOffset,
              original != current
        else {
            return
        }

        // Selection paging is a preview; it must not advance the reading position.
        selectionRestoreGeneration += 1
        let generation = selectionRestoreGeneration
        selectionRestorePending = generation
        selectionScrollOffset = original
        scrollView.setContentOffset(original, animated: false)

        // Readium posts progression in requestAnimationFrame. Keep ignoring it until
        // restoration and the already queued preview messages have passed the bridge.
        selectionRestoreTask?.cancel()
        selectionRestoreTask = Task { [weak self] in
            guard let self else {
                return
            }

            let result = await self.evaluateScript("""
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    window.webkit.messageHandlers.aldusSelectionRestored.postMessage(\(generation));
                }));
                """)
            guard !Task.isCancelled, self.selectionRestorePending == generation else {
                return
            }

            if case .failure = result {
                // A failed/terminated web process must not permanently suppress progress.
                self.selectionRestorePending = nil
            }
        }
    }

    func advanceSelectionPage() {
        guard window != nil, isSelectingText, !viewModel.scroll,
              var offset = selectionScrollOffset
        else {
            return
        }

        guard let next = AldusSelectionPaging.nextOffset(
            current: offset.x,
            width: scrollView.bounds.width,
            contentWidth: scrollView.contentSize.width,
            rightToLeft: viewModel.readingProgression == .rtl
        ) else {
            return
        }

        // ponytail: one document only; crossing resources needs a separate selection model.
        // Install the new anchor before the synchronous scroll callback can restore it.
        offset.x = next
        selectionScrollOffset = offset
        scrollView.setContentOffset(offset, animated: false)
    }
}
#endif
