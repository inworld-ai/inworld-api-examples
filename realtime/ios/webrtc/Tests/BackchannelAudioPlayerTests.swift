import AVFoundation
import XCTest
@testable import InworldVoiceAgent

final class BackchannelAudioPlayerTests: XCTestCase {
    private let format = AVAudioFormat(standardFormatWithSampleRate: 24000, channels: 1)!

    func testPCM16DecodesToExpectedFrameCountAndValues() throws {
        // Two little-endian Int16 samples: 0 and 16384 (= 0.5 in float).
        let pcm16 = Data([0x00, 0x00, 0x00, 0x40])
        let buffer = try XCTUnwrap(BackchannelAudioPlayer.makeBuffer(from: pcm16, format: format))

        XCTAssertEqual(buffer.frameLength, 2)
        let channel = try XCTUnwrap(buffer.floatChannelData)
        XCTAssertEqual(channel[0][0], 0.0, accuracy: 0.0001)
        XCTAssertEqual(channel[0][1], 0.5, accuracy: 0.0001)
    }

    func testEmptyDataYieldsNoBuffer() {
        XCTAssertNil(BackchannelAudioPlayer.makeBuffer(from: Data(), format: format))
    }
}
