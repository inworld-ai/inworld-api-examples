import AVFoundation
import WebRTC

enum AudioSessionController {
    /// Must run before the peer connection factory is created: WebRTC re-applies
    /// this template whenever its audio unit starts, so it is the reliable lever
    /// for speaker routing (`.voiceChat` alone routes to the earpiece).
    static func configureForVoiceChat() {
        let config = RTCAudioSessionConfiguration.webRTC()
        config.category = AVAudioSession.Category.playAndRecord.rawValue
        config.mode = AVAudioSession.Mode.voiceChat.rawValue
        config.categoryOptions = [.defaultToSpeaker, .allowBluetooth, .allowBluetoothA2DP]
        RTCAudioSessionConfiguration.setWebRTC(config)
    }

    static func overrideToSpeaker() {
        let session = RTCAudioSession.sharedInstance()
        session.lockForConfiguration()
        try? session.overrideOutputAudioPort(.speaker)
        session.unlockForConfiguration()
    }

    static func deactivate() {
        let session = RTCAudioSession.sharedInstance()
        session.lockForConfiguration()
        try? session.setActive(false)
        session.unlockForConfiguration()
    }
}
