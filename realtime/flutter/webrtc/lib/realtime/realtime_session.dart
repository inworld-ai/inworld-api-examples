import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:permission_handler/permission_handler.dart';

import '../audio/backchannel_player.dart';
import '../auth/auth_provider.dart';
import '../webrtc/webrtc_client.dart';
import 'events/client_events.dart';
import 'events/server_event.dart';
import 'session_config.dart';
import 'signaling_api.dart';

enum SessionStatus { idle, connecting, connected, failed }

class SessionState {
  const SessionState(this.status, [this.message]);
  final SessionStatus status;
  final String? message;

  static const idle = SessionState(SessionStatus.idle);
  static const connecting = SessionState(SessionStatus.connecting);
  static const connected = SessionState(SessionStatus.connected);
}

class RealtimeSession {
  RealtimeSession({required this.authProvider, required this.config});

  final AuthProvider authProvider;
  final SessionConfig config;

  final BackchannelPlayer _backchannelPlayer = BackchannelPlayer();
  WebRtcClient? _client;
  bool _interrupted = false;

  SessionState _state = SessionState.idle;
  SessionState get state => _state;

  void Function(SessionState state)? onStateChange;
  void Function(ServerEvent event)? onEvent;

  void _setState(SessionState next) {
    _state = next;
    onStateChange?.call(next);
  }

  Future<void> connect() async {
    if (_state.status != SessionStatus.idle &&
        _state.status != SessionStatus.failed) {
      return;
    }
    _setState(SessionState.connecting);
    try {
      final mic = await Permission.microphone.request();
      if (!mic.isGranted) {
        _setState(const SessionState(
          SessionStatus.failed,
          'Microphone access denied. Enable it in system Settings.',
        ));
        return;
      }

      final credentials = await authProvider.credentials();
      final api = SignalingApi(credentials);
      final iceServers = await api.fetchIceServers();

      final client = await WebRtcClient.create(iceServers);
      _client = client;
      _wireCallbacks(client);

      final offer = await client.makeOfferSdp();
      final answer = await api.postOffer(offer);
      await client.setAnswer(answer);
    } catch (error) {
      await disconnect(failure: error.toString());
    }
  }

  Future<void> disconnect({String? failure}) async {
    await _client?.close();
    _client = null;
    await _backchannelPlayer.stop();
    _interrupted = false;
    _setState(
      failure != null ? SessionState(SessionStatus.failed, failure) : SessionState.idle,
    );
  }

  void setMicEnabled(bool enabled) => _client?.setMicEnabled(enabled);

  void _wireCallbacks(WebRtcClient client) {
    client.onDataChannelOpen = _sendInitialEvents;
    client.onServerEvent = _handle;
    client.onConnectionStateChange = _handleConnectionState;
  }

  void _sendInitialEvents() {
    final client = _client;
    if (client == null) return;
    client.send(sessionUpdateEvent(config));
    client.send(conversationItemCreateEvent(config.greetingPrompt));
    client.send(responseCreateEvent());
    _setState(SessionState.connected);
  }

  void _handle(ServerEvent event) {
    switch (event) {
      case SpeechStarted():
        // Barge-in: silence the agent immediately, cancel its response.
        _interrupted = true;
        _client?.setAgentAudioEnabled(false);
        _client?.send(responseCancelEvent());
      case OutputItemAdded():
        if (_interrupted) {
          _client?.setAgentAudioEnabled(true);
          _interrupted = false;
        }
      case BackchannelAudioDelta(:final base64Pcm16):
        _backchannelPlayer.enqueue(base64Pcm16);
      case BackchannelAudioDone():
        _backchannelPlayer.flush();
      default:
        break;
    }
    onEvent?.call(event);
  }

  void _handleConnectionState(RTCPeerConnectionState pcState) {
    switch (pcState) {
      case RTCPeerConnectionState.RTCPeerConnectionStateFailed:
        disconnect(failure: 'Connection lost.');
      case RTCPeerConnectionState.RTCPeerConnectionStateDisconnected:
      case RTCPeerConnectionState.RTCPeerConnectionStateClosed:
        if (_state.status == SessionStatus.connected) disconnect();
      default:
        break;
    }
  }
}
