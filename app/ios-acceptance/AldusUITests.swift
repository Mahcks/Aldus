import XCTest

final class AldusUITests: XCTestCase {
  private let timeout: TimeInterval = 45

  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  func testReaderAcceptance() throws {
    let environment = ProcessInfo.processInfo.environment
    let server = try XCTUnwrap(environment["ALDUS_ACCEPTANCE_SERVER"])
    let username = environment["ALDUS_ACCEPTANCE_USERNAME"] ?? "acceptance-admin"
    let password = environment["ALDUS_ACCEPTANCE_PASSWORD"] ?? "aldus-acceptance-123"
    let app = XCUIApplication()

    addUIInterruptionMonitor(withDescription: "Local network access") { alert in
      let allow = alert.buttons["Allow"]
      guard allow.exists else { return false }
      allow.tap()
      return true
    }

    app.launch()
    enter(server, in: app.textFields["Library address"])
    tap("Continue", in: app)
    app.tap()

    let usernameField = app.textFields["Username"]
    if !usernameField.waitForExistence(timeout: 5) {
      let retry = app.buttons["Continue"]
      XCTAssertTrue(retry.waitForExistence(timeout: 5), "Library connection did not complete")
      retry.tap()
    }
    enter(username, in: usernameField)
    enter("Acceptance Admin", in: app.textFields["Display name"])
    enter(password, in: app.secureTextFields["Password (12 characters minimum)"])
    enter(password, in: app.secureTextFields["Confirm password"])
    tap("Create administrator", in: app)

    tap("Public", in: app)
    let alice = element(startingWith: "Alice's Adventures in Wonderland", in: app)
    XCTAssertTrue(alice.waitForExistence(timeout: timeout))
    alice.tap()

    tap("Download for offline", in: app)
    XCTAssertTrue(
      app.buttons["Remove download from this device"].waitForExistence(timeout: 90),
      "Alice should finish downloading for offline use"
    )
    tap("Start reading", in: app)

    let nextPage = app.buttons["Next page"]
    let previousPage = app.buttons["Previous page"]
    XCTAssertTrue(nextPage.waitForExistence(timeout: timeout))
    XCTAssertTrue(previousPage.exists)
    evidence("01-epub-opened")
    nextPage.tap()
    XCTAssertTrue(element(containing: "Saved here", in: app).waitForExistence(timeout: timeout))
    previousPage.tap()
    XCTAssertTrue(element(containing: "Saved here", in: app).waitForExistence(timeout: timeout))

    XCUIDevice.shared.press(.home)
    app.activate()
    XCTAssertTrue(nextPage.waitForExistence(timeout: timeout))

    app.terminate()
    app.launch()
    if !app.buttons["Next page"].waitForExistence(timeout: 10) {
      let continueReading = element(startingWith: "Continue reading Alice's Adventures", in: app)
      XCTAssertTrue(continueReading.waitForExistence(timeout: timeout))
      continueReading.tap()
    }
    XCTAssertTrue(app.buttons["Next page"].waitForExistence(timeout: timeout))
    evidence("02-reader-restored")

    tap("Switch to listening", in: app)
    let play = app.buttons["Play"]
    XCTAssertTrue(play.waitForExistence(timeout: timeout))
    play.tap()
    let pause = app.buttons["Pause"]
    XCTAssertTrue(pause.waitForExistence(timeout: timeout))
    pause.tap()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: timeout))
    tap("Skip forward 15 seconds", in: app)
    tap("Rewind 15 seconds", in: app)

    let speed = app.descendants(matching: .any)["Playback speed"]
    XCTAssertTrue(speed.waitForExistence(timeout: timeout))
    let initialSpeed = try XCTUnwrap(speed.value as? String)
    speed.tap()
    let speedChanged = XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "value != %@", initialSpeed),
      object: speed
    )
    XCTAssertEqual(XCTWaiter.wait(for: [speedChanged], timeout: 5), .completed)
    let chapters = element(startingWith: "View chapters. Current chapter:", in: app)
    XCTAssertTrue(chapters.waitForExistence(timeout: timeout))
    chapters.tap()
    XCTAssertTrue(app.staticTexts["Chapters"].waitForExistence(timeout: timeout))
    tap("Close dialog", in: app)
    evidence("03-audio-playing")

    tap("Switch to reading", in: app)
    XCTAssertTrue(app.buttons["Switch to listening"].waitForExistence(timeout: timeout))
    tap("Switch to listening", in: app)
    XCTAssertTrue(app.buttons["Switch to reading"].waitForExistence(timeout: timeout))
    tap("Switch to reading", in: app)
    XCTAssertTrue(app.buttons["Next page"].waitForExistence(timeout: timeout))

    tap("Back to work", in: app)
    tap("Open account", in: app)
    XCTAssertTrue(app.buttons["Switch server"].waitForExistence(timeout: timeout))
    scrollUntilVisible(element(startingWith: "Support", in: app), in: app)
    XCTAssertTrue(element(startingWith: "Privacy policy", in: app).exists)
    let deleteAccount = app.buttons["Delete account"].firstMatch
    scrollUntilVisible(deleteAccount, in: app)
    XCTAssertTrue(app.staticTexts["Aldus does not send diagnostics automatically. You choose what to share with support."].exists)
    deleteAccount.tap()
    XCTAssertTrue(
      app.staticTexts["Permanently delete your account?"].waitForExistence(timeout: timeout)
    )
    tap("Close dialog", in: app)
    evidence("04-account-controls")
  }

  private func enter(_ value: String, in field: XCUIElement) {
    XCTAssertTrue(field.waitForExistence(timeout: timeout))
    field.tap()
    field.typeText(value)
  }

  private func tap(_ label: String, in app: XCUIApplication) {
    let element = app.descendants(matching: .any)[label]
    XCTAssertTrue(element.waitForExistence(timeout: timeout), "Missing control: \(label)")
    element.tap()
  }

  private func element(startingWith prefix: String, in app: XCUIApplication) -> XCUIElement {
    app.descendants(matching: .any)
      .matching(NSPredicate(format: "label BEGINSWITH %@", prefix))
      .firstMatch
  }

  private func element(containing text: String, in app: XCUIApplication) -> XCUIElement {
    app.descendants(matching: .any)
      .matching(NSPredicate(format: "label CONTAINS %@", text))
      .firstMatch
  }

  private func scrollUntilVisible(_ element: XCUIElement, in app: XCUIApplication) {
    for _ in 0..<8 where !element.exists || !element.isHittable {
      app.swipeUp()
    }
    XCTAssertTrue(element.exists)
  }

  private func evidence(_ name: String) {
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
