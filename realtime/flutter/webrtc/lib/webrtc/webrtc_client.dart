import 'dart:convert';

import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../auth/auth_provider.dart';
import '../realtime/events/server_event.dart';
import 'ice_gathering_waiter.dart';

/// Thin wrapper over a single audio-only WebRTC peer connection plus the
/// `oai-events` data channel. Ports the native examples' WebRTCClient.
class WebRtcClient {
  WebRtcClient._(this._pc, this._dc, this._localStream);

  final RTCPeerConnection _pc;
  final RTCDataChannel _dc;
  final MediaStream _localStream;
  final IceGatheringWaiter _iceWaiter = IceGatheringWaiter();
  MediaStreamTrack? _remoteAudioTrack;

  void Function()? onDataChannelOpen;
  void Function(ServerEvent event)? onServerEvent;
  void Function(RTCPeerConnectionState state)? onConnectionStateChange;

  static Future<WebRtcClient> create(List<IceServer> iceServers) async {
    final configuration = <String, dynamic>{
      'sdpSemantics': 'unified-plan',
      'iceServers': iceServers
          .map((s) => <String, dynamic>{
                'urls': s.urls,
                if (s.username != null) 'username': s.username,
                if (s.credential != null) 'credential': s.credential,
              })
          .toList(),
    };

    final pc = await createPeerConnection(configuration);
    final dc = await pc.createDataChannel(
      'oai-events',
      RTCDataChannelInit()..ordered = true,
    );

    // Audio-only capture. Echo cancellation / noise suppression are applied by the
    // platform voice-processing unit once the track is attached to the connection.
    final localStream = await navigator.mediaDevices.getUserMedia({
      'audio': true,
      'video': false,
    });
    for (final track in localStream.getAudioTracks()) {
      await pc.addTrack(track, localStream);
    }

    final client = WebRtcClient._(pc, dc, localStream);
    client._wire();
    return client;
  }

  void _wire() {
    _pc.onIceGatheringState = (state) {
      if (state == RTCIceGatheringState.RTCIceGatheringStateComplete) {
        _iceWaiter.gatheringComplete();
      }
    };
    _pc.onIceCandidate = (_) => _iceWaiter.candidateGenerated();
    _pc.onConnectionState = (state) => onConnectionStateChange?.call(state);
    _pc.onTrack = (RTCTrackEvent event) {
      if (event.track.kind == 'audio') _remoteAudioTrack = event.track;
    };

    _dc.onDataChannelState = (state) {
      if (state == RTCDataChannelState.RTCDataChannelOpen) {
        onDataChannelOpen?.call();
      }
    };
    _dc.onMessage = (RTCDataChannelMessage message) {
      if (!message.isBinary) {
        onServerEvent?.call(ServerEvent.decode(message.text));
      }
    };
  }

  Future<String> makeOfferSdp() async {
    _iceWaiter.start();
    final offer = await _pc.createOffer();
    await _pc.setLocalDescription(offer);
    await _iceWaiter.done;
    final local = await _pc.getLocalDescription();
    return local!.sdp!;
  }

  Future<void> setAnswer(String sdp) async {
    await _pc.setRemoteDescription(RTCSessionDescription(sdp, 'answer'));
  }

  void send(Map<String, dynamic> event) {
    if (_dc.state != RTCDataChannelState.RTCDataChannelOpen) return;
    _dc.send(RTCDataChannelMessage(jsonEncode(event)));
  }

  void setAgentAudioEnabled(bool enabled) {
    _remoteAudioTrack?.enabled = enabled;
  }

  void setMicEnabled(bool enabled) {
    for (final track in _localStream.getAudioTracks()) {
      track.enabled = enabled;
    }
  }

  Future<void> close() async {
    // Dispose order matters: data channel → tracks → peer connection.
    await _dc.close();
    for (final track in _localStream.getAudioTracks()) {
      await track.stop();
    }
    await _localStream.dispose();
    await _pc.close();
    await _pc.dispose();
  }
}
