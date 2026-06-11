import XCTest
@testable import InworldVoiceAgent

final class CatalogDecodingTests: XCTestCase {
    func testModelDecodingAndRealtimeIdentifier() throws {
        let json = #"""
        {"model": "gemini-2.5-flash", "provider": "google", "modelCreator": "Google", "isSupported": true}
        """#
        let model = try JSONDecoder().decode(LLMModelInfo.self, from: Data(json.utf8))
        XCTAssertEqual(model.model, "gemini-2.5-flash")
        XCTAssertEqual(model.provider, "google")
        XCTAssertEqual(model.realtimeIdentifier, "google/gemini-2.5-flash")
    }

    func testRealtimeIdentifierLeavesPrefixedModelUntouched() {
        let model = LLMModelInfo(model: "openai/gpt-4o-mini", provider: "openai")
        XCTAssertEqual(model.realtimeIdentifier, "openai/gpt-4o-mini")
    }

    func testRealtimeIdentifierWithoutProvider() {
        let model = LLMModelInfo(model: "gpt-4o-mini", provider: nil)
        XCTAssertEqual(model.realtimeIdentifier, "gpt-4o-mini")
    }

    func testRealtimeIdentifierPrefixesProviderWhenModelHasSlash() {
        // Inworld- and deepinfra-served models carry slashes in the model string itself.
        XCTAssertEqual(
            LLMModelInfo(model: "models/GLM-5.1", provider: "inworld").realtimeIdentifier,
            "inworld/models/GLM-5.1"
        )
        XCTAssertEqual(
            LLMModelInfo(model: "MiniMaxAI/MiniMax-M2.5", provider: "deepinfra").realtimeIdentifier,
            "deepinfra/MiniMaxAI/MiniMax-M2.5"
        )
    }

    func testVoiceDecoding() throws {
        let json = #"""
        {"name": "workspaces/inworld/voices/Alex", "voiceId": "Alex", "langCode": "EN_US",
         "displayName": "Alex", "gender": "male", "source": "SYSTEM"}
        """#
        let voice = try JSONDecoder().decode(VoiceInfo.self, from: Data(json.utf8))
        XCTAssertEqual(voice.voiceId, "Alex")
        XCTAssertEqual(voice.displayName, "Alex")
        XCTAssertEqual(voice.langCode, "EN_US")
        XCTAssertEqual(voice.gender, "male")
        XCTAssertEqual(voice.source, "SYSTEM")
    }
}
