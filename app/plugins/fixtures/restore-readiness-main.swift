import Foundation

@MainActor
private final class LoadDelegate {
    let events: AsyncStream<String>.Continuation
    var continuation: CheckedContinuation<Void, Never>?

    init(events: AsyncStream<String>.Continuation) { self.events = events }

    func spreadViewDidLoad(_ spread: Spread) async {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            events.yield("delegate")
        }
    }
}

@MainActor
private final class CompletionList {
    func complete() {}
}

@MainActor
private final class Spread {
    let events = AsyncStream<String>.makeStream()
    lazy var delegate: LoadDelegate? = LoadDelegate(events: events.continuation)
    let onSpreadLoadedCallbacks = CompletionList()
    var continuation: CheckedContinuation<Void, Never>?

    // PATCHED_LIFECYCLE

    func applySettings() {}
    func showSpread() { events.continuation.yield("ready") }

    func spreadDidLoad() async {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            events.continuation.yield("pending-navigation")
        }
    }

    func start() { spreadDidLoad(()) }
    func reload() { spreadLoadDidStart(()) }
}

@main
struct ReadinessRegression {
    @MainActor
    static func main() async {
        let spread = Spread()
        var events = spread.events.stream.makeAsyncIterator()
        spread.start()
        let first = await events.next()
        precondition(first == "pending-navigation")
        precondition(spread.isSpreadLoaded && !spread.isAldusRestoreReady)
        spread.continuation?.resume()
        let second = await events.next()
        precondition(second == "delegate")
        precondition(!spread.isAldusRestoreReady)
        spread.delegate?.continuation?.resume()
        let third = await events.next()
        precondition(third == "ready" && spread.isAldusRestoreReady)
        spread.reload()
        precondition(!spread.isAldusRestoreReady)
        print("Restore readiness waits for pending navigation and delegate completion")
    }
}
