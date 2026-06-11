import XCTest
@testable import InworldVoiceAgent

@MainActor
final class ConversationViewModelTests: XCTestCase {
    private func makeViewModel() -> ConversationViewModel {
        ConversationViewModel(settings: SettingsStore(defaults: UserDefaults(suiteName: UUID().uuidString)!))
    }

    func testAgentDeltaStreamingAndFinalize() {
        let vm = makeViewModel()
        vm.handle(.outputTextDelta("Hel"))
        vm.handle(.outputTextDelta("lo!"))
        XCTAssertEqual(vm.transcript.count, 1)
        XCTAssertEqual(vm.transcript[0].text, "Hello!")
        XCTAssertTrue(vm.transcript[0].isStreaming)

        vm.handle(.transcriptDone("Hello there!"))
        XCTAssertEqual(vm.transcript[0].text, "Hello there!")
        XCTAssertFalse(vm.transcript[0].isStreaming)
    }

    func testFinalizeWithNilKeepsAccumulatedText() {
        let vm = makeViewModel()
        vm.handle(.outputTextDelta("Hi"))
        vm.handle(.responseDone)
        XCTAssertEqual(vm.transcript[0].text, "Hi")
        XCTAssertFalse(vm.transcript[0].isStreaming)
    }

    func testUserTranscriptAppends() {
        let vm = makeViewModel()
        vm.handle(.inputTranscriptionCompleted("What's up?"))
        XCTAssertEqual(vm.transcript.count, 1)
        XCTAssertEqual(vm.transcript[0].role, .user)
        XCTAssertEqual(vm.transcript[0].text, "What's up?")
    }

    func testUserPartialTranscriptStreamsThenFinalizes() {
        let vm = makeViewModel()
        vm.handle(.inputTranscriptionDelta("what "))
        vm.handle(.inputTranscriptionDelta("time"))
        XCTAssertEqual(vm.transcript.count, 1)
        XCTAssertEqual(vm.transcript[0].role, .user)
        XCTAssertEqual(vm.transcript[0].text, "what time")
        XCTAssertTrue(vm.transcript[0].isStreaming)

        vm.handle(.inputTranscriptionCompleted("What time is it?"))
        XCTAssertEqual(vm.transcript.count, 1)
        XCTAssertEqual(vm.transcript[0].text, "What time is it?")
        XCTAssertFalse(vm.transcript[0].isStreaming)
    }

    func testCumulativePartialsDoNotDuplicate() {
        // Soniox-style: each partial is the full text so far.
        let vm = makeViewModel()
        vm.handle(.inputTranscriptionDelta("what"))
        vm.handle(.inputTranscriptionDelta("what time"))
        vm.handle(.inputTranscriptionDelta("what time is it"))
        XCTAssertEqual(vm.transcript.count, 1)
        XCTAssertEqual(vm.transcript[0].text, "what time is it")
    }

    func testReconcileTranscriptHandlesBothShapes() {
        typealias VM = ConversationViewModel
        // Cumulative
        XCTAssertEqual(VM.reconcileTranscript(existing: "what", delta: "what time"), "what time")
        // Duplicate cumulative re-send
        XCTAssertEqual(VM.reconcileTranscript(existing: "what time", delta: "what time"), "what time")
        // Stale shorter snapshot
        XCTAssertEqual(VM.reconcileTranscript(existing: "what time", delta: "what"), "what time")
        // Incremental chunk
        XCTAssertEqual(VM.reconcileTranscript(existing: "what", delta: " time"), "what time")
        // First chunk
        XCTAssertEqual(VM.reconcileTranscript(existing: "", delta: "what"), "what")
    }

    func testSecondUserTurnStartsNewBubble() {
        let vm = makeViewModel()
        vm.handle(.inputTranscriptionDelta("hi"))
        vm.handle(.inputTranscriptionCompleted("Hi."))
        vm.handle(.inputTranscriptionDelta("bye"))
        XCTAssertEqual(vm.transcript.count, 2)
        XCTAssertEqual(vm.transcript[1].text, "bye")
        XCTAssertTrue(vm.transcript[1].isStreaming)
    }

    func testEmptyFinalKeepsStreamedPartialText() {
        let vm = makeViewModel()
        vm.handle(.inputTranscriptionDelta("hello"))
        vm.handle(.inputTranscriptionCompleted("  "))
        XCTAssertEqual(vm.transcript.count, 1)
        XCTAssertEqual(vm.transcript[0].text, "hello")
        XCTAssertFalse(vm.transcript[0].isStreaming)
    }

    func testBargeInDropsStreamingAgentBubble() {
        let vm = makeViewModel()
        vm.handle(.outputTextDelta("I was saying"))
        vm.handle(.speechStarted)
        XCTAssertTrue(vm.transcript.isEmpty)

        // New agent response after barge-in starts a fresh bubble
        vm.handle(.outputTextDelta("Sure,"))
        XCTAssertEqual(vm.transcript.count, 1)
        XCTAssertEqual(vm.transcript[0].text, "Sure,")
    }

    func testBargeInKeepsFinalizedBubbles() {
        let vm = makeViewModel()
        vm.handle(.outputTextDelta("Done answer"))
        vm.handle(.responseDone)
        vm.handle(.speechStarted)
        XCTAssertEqual(vm.transcript.count, 1)
    }

    func testNewResponseAfterFinalizeStartsNewBubble() {
        let vm = makeViewModel()
        vm.handle(.outputTextDelta("First"))
        vm.handle(.responseDone)
        vm.handle(.outputTextDelta("Second"))
        XCTAssertEqual(vm.transcript.count, 2)
        XCTAssertEqual(vm.transcript[1].text, "Second")
    }

    func testEmptyUserTranscriptIgnored() {
        let vm = makeViewModel()
        vm.handle(.inputTranscriptionCompleted("  \n"))
        XCTAssertTrue(vm.transcript.isEmpty)
    }
}
