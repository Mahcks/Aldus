import Foundation
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

    guard app.staticTexts["Libraries"].waitForExistence(timeout: 15) else {
      let visibleText = app.staticTexts.allElementsBoundByIndex
        .map(\.label)
        .filter { !$0.isEmpty }
        .joined(separator: " | ")
      XCTFail("Administrator creation did not reach Libraries. Visible text: \(visibleText)")
      return
    }
    tap("Public", in: app)
    openAlice(in: app)

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

    if environment["ALDUS_ACCEPTANCE_FAULTS"] == "1" {
      toggleFixtureNetwork(in: app, expecting: "Acceptance network disconnected")
      nextPage.tap()
      XCTAssertTrue(
        element(containing: "Saved on this device", in: app).waitForExistence(timeout: timeout),
        "Progress should queue while the fixture server is unavailable"
      )

      app.terminate()
      app.launch()
      reopenAliceIfNeeded(in: app)
      XCTAssertTrue(app.buttons["Next page"].waitForExistence(timeout: timeout))
      evidence("02-offline-reader-restored")

      tap("Toggle acceptance network", in: app)
      let reconciliation = app.buttons
        .matching(
          NSPredicate(
            format: "label == %@ OR label BEGINSWITH %@",
            "Acceptance progress reconciled",
            "Acceptance failed:"
          )
        )
        .firstMatch
      XCTAssertTrue(reconciliation.waitForExistence(timeout: timeout))
      XCTAssertTrue(
        reconciliation.label == "Acceptance progress reconciled",
        "Queued progress should reconcile after the fixture server returns. Outcome: \(reconciliation.label)"
      )
      nextPage.tap()
      XCTAssertTrue(element(containing: "Saved here", in: app).waitForExistence(timeout: timeout))
      evidence("03-offline-progress-reconciled")
    }

    XCUIDevice.shared.press(.home)
    app.activate()
    XCTAssertTrue(nextPage.waitForExistence(timeout: timeout))

    app.terminate()
    app.launch()
    reopenAliceIfNeeded(in: app)
    XCTAssertTrue(app.buttons["Next page"].waitForExistence(timeout: timeout))
    evidence("04-reader-restored")

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
    tap("Close dialog", in: app)
    evidence("05-audio-playing")

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
    evidence("06-account-controls")
  }

  func testEcosystemHandoff() throws {
    let environment = ProcessInfo.processInfo.environment
    let server = try XCTUnwrap(environment["ALDUS_ACCEPTANCE_SERVER"])
    let username = environment["ALDUS_ACCEPTANCE_USERNAME"] ?? "ecosystem-admin"
    let password = environment["ALDUS_ACCEPTANCE_PASSWORD"] ?? "aldus-ecosystem-123"
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
      tap("Continue", in: app)
    }
    enter(username, in: usernameField)
    enter(password, in: app.secureTextFields["Password"])
    tap("Sign in", in: app)

    openAlice(in: app)
    let readInstead = app.buttons["Read instead"]
    if readInstead.waitForExistence(timeout: 5) {
      readInstead.tap()
    } else {
      let continueReading = element(startingWith: "Continue reading", in: app)
      XCTAssertTrue(continueReading.waitForExistence(timeout: timeout))
      continueReading.tap()
    }

    XCTAssertTrue(app.buttons["Next page"].waitForExistence(timeout: timeout))
    XCTAssertTrue(
      element(containing: "Resumed from KOReader", in: app).waitForExistence(timeout: timeout),
      "The iPhone did not restore KOReader's position"
    )
    evidence("ecosystem-01-koreader-restored")
    tap("Next page", in: app)
    XCTAssertTrue(element(containing: "Saved here", in: app).waitForExistence(timeout: timeout))
    tap("Switch to listening", in: app)
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: timeout))
    tap("Switch to reading", in: app)
    XCTAssertTrue(app.buttons["Next page"].waitForExistence(timeout: timeout))
    evidence("ecosystem-02-ios-advanced")
  }

  private func enter(_ value: String, in field: XCUIElement) {
    XCTAssertTrue(field.waitForExistence(timeout: timeout))
    field.tap()
    field.typeText(value)
  }

  private func openAlice(in app: XCUIApplication) {
    let title = "Alice's Adventures in Wonderland"
    let alice = app.links
      .matching(NSPredicate(format: "label BEGINSWITH %@ OR label BEGINSWITH %@", title, "Open \(title)"))
      .firstMatch
    XCTAssertTrue(alice.waitForExistence(timeout: timeout), "Alice is missing from the current page")
    alice.tap()
  }

  private func reopenAliceIfNeeded(in app: XCUIApplication) {
    if app.buttons["Next page"].waitForExistence(timeout: 10) { return }
    let continueReading = element(startingWith: "Continue reading Alice's Adventures", in: app)
    XCTAssertTrue(continueReading.waitForExistence(timeout: timeout))
    continueReading.tap()
  }

  private func toggleFixtureNetwork(in app: XCUIApplication, expecting state: String) {
    tap("Toggle acceptance network", in: app)
    XCTAssertTrue(
      app.buttons[state].waitForExistence(timeout: 15),
      "The acceptance app could not toggle the fixture network"
    )
  }

  private func tap(_ label: String, in app: XCUIApplication) {
    let element = app.descendants(matching: .any)[label]
    XCTAssertTrue(element.waitForExistence(timeout: timeout), "Missing control: \(label)")
    let ready = XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "enabled == true AND hittable == true"),
      object: element
    )
    XCTAssertEqual(
      XCTWaiter.wait(for: [ready], timeout: timeout),
      .completed,
      "Control did not become ready: \(label)"
    )
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
