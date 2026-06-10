import Foundation
import WebRTC

final class WebRTCClient: NSObject {
    private static let factory: RTCPeerConnectionFactory = {
        AudioSessionController.configureForVoiceChat()
        RTCInitializeSSL()
        return RTCPeerConnectionFactory()
    }()

    private let peerConnection: RTCPeerConnection
    private let dataChannel: RTCDataChannel
    private let localAudioTrack: RTCAudioTrack
    private let iceWaiter = IceGatheringWaiter()
    private var remoteAudioTrack: RTCAudioTrack?

    var onDataChannelOpen: (() -> Void)?
    var onServerEvent: ((ServerEvent) -> Void)?
    var onConnectionStateChange: ((RTCPeerConnectionState) -> Void)?

    init(iceServers: [IceServer]) throws {
        let config = RTCConfiguration()
        config.sdpSemantics = .unifiedPlan
        config.iceServers = iceServers.map {
            RTCIceServer(urlStrings: $0.urls, username: $0.username, credential: $0.credential)
        }

        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        guard let pc = Self.factory.peerConnection(with: config, constraints: constraints, delegate: nil) else {
            throw SignalingError.malformedResponse
        }
        peerConnection = pc

        let dcConfig = RTCDataChannelConfiguration()
        dcConfig.isOrdered = true
        guard let dc = pc.dataChannel(forLabel: "oai-events", configuration: dcConfig) else {
            throw SignalingError.malformedResponse
        }
        dataChannel = dc

        let audioSource = Self.factory.audioSource(with: RTCMediaConstraints(
            mandatoryConstraints: [
                "googEchoCancellation": "true",
                "googNoiseSuppression": "true",
            ],
            optionalConstraints: nil
        ))
        localAudioTrack = Self.factory.audioTrack(with: audioSource, trackId: "mic0")
        pc.add(localAudioTrack, streamIds: ["stream0"])

        super.init()
        pc.delegate = self
        dc.delegate = self
    }

    func makeOfferSDP() async throws -> String {
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        let offer = try await peerConnection.offer(for: constraints)
        try await peerConnection.setLocalDescription(offer)
        await iceWaiter.wait(peerConnection: peerConnection)
        guard let sdp = peerConnection.localDescription?.sdp else {
            throw SignalingError.malformedResponse
        }
        return sdp
    }

    func setAnswer(sdp: String) async throws {
        try await peerConnection.setRemoteDescription(RTCSessionDescription(type: .answer, sdp: sdp))
    }

    func send(_ event: some Encodable) {
        guard dataChannel.readyState == .open,
              let data = try? ClientEventEncoder.encode(event) else { return }
        dataChannel.sendData(RTCDataBuffer(data: data, isBinary: false))
    }

    func setAgentAudioEnabled(_ enabled: Bool) {
        remoteAudioTrack?.isEnabled = enabled
    }

    func setMicEnabled(_ enabled: Bool) {
        localAudioTrack.isEnabled = enabled
    }

    func close() {
        dataChannel.close()
        peerConnection.close()
    }
}

extension WebRTCClient: RTCPeerConnectionDelegate {
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}

    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {
        if let track = stream.audioTracks.first {
            remoteAudioTrack = track
        }
    }

    func peerConnection(_ peerConnection: RTCPeerConnection,
                        didAdd rtpReceiver: RTCRtpReceiver,
                        streams mediaStreams: [RTCMediaStream]) {
        if let track = rtpReceiver.track as? RTCAudioTrack {
            remoteAudioTrack = track
        }
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}

    func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {}

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {
        iceWaiter.gatheringStateChanged(newState)
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCPeerConnectionState) {
        onConnectionStateChange?(newState)
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        iceWaiter.candidateGenerated()
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}

    func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}
}

extension WebRTCClient: RTCDataChannelDelegate {
    func dataChannelDidChangeState(_ dataChannel: RTCDataChannel) {
        if dataChannel.readyState == .open {
            onDataChannelOpen?()
        }
    }

    func dataChannel(_ dataChannel: RTCDataChannel, didReceiveMessageWith buffer: RTCDataBuffer) {
        onServerEvent?(ServerEvent.decode(buffer.data))
    }
}
