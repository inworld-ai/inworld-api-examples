import 'package:flutter/foundation.dart';

import '../realtime/events/server_event.dart';
import '../realtime/realtime_session.dart';
import '../storage/settings.dart';
import 'transcript_item.dart';

class ConversationController extends ChangeNotifier {
  ConversationController(this._settings);

  final SettingsStore _settings;
  RealtimeSession? _session;

  final List<TranscriptItem> _transcript = [];
  List<TranscriptItem> get transcript => List.unmodifiable(_transcript);

  SessionState _state = SessionState.idle;
  SessionState get state => _state;

  bool _isMicMuted = false;
  bool get isMicMuted => _isMicMuted;

  int _nextId = 0;
  int? _streamingAgentId;
  int? _streamingUserId;

  bool get isConnected => _state.status == SessionStatus.connected;
  bool get isBusy => _state.status == SessionStatus.connecting;
  String? get errorMessage =>
      _state.status == SessionStatus.failed ? _state.message : null;

  Future<void> connect() async {
    _transcript.clear();
    _streamingAgentId = null;
    _streamingUserId = null;
    _isMicMuted = false;
    notifyListeners();

    final session = RealtimeSession(
      authProvider: _settings.makeAuthProvider(),
      config: _settings.makeSessionConfig(),
    );
    session.onStateChange = (state) {
      _state = state;
      notifyListeners();
    };
    session.onEvent = _handle;
    _session = session;
    await session.connect();
  }

  Future<void> disconnect() async {
    await _session?.disconnect();
    _session = null;
    _streamingAgentId = null;
    _streamingUserId = null;
    notifyListeners();
  }

  void setMicMuted(bool muted) {
    _isMicMuted = muted;
    _session?.setMicEnabled(!muted);
    notifyListeners();
  }

  void _handle(ServerEvent event) {
    switch (event) {
      case OutputTextDelta(:final delta):
        _appendAgentDelta(delta);
      case TranscriptDone(:final text):
        _finalizeAgentItem(text);
      case InputTranscriptionDelta(:final delta):
        _appendUserDelta(delta);
      case InputTranscriptionCompleted(:final transcript):
        _finalizeUserItem(transcript);
      case SpeechStarted():
        _dropStreamingAgentItem();
      case ResponseDone():
        _finalizeAgentItem(null);
      case ErrorEvent(:final message):
        _state = SessionState(SessionStatus.failed, message);
      default:
        // Back-channel audio is played in the realtime layer; nothing to show.
        break;
    }
    notifyListeners();
  }

  void _appendAgentDelta(String delta) {
    if (delta.isEmpty) return;
    final index = _indexOf(_streamingAgentId);
    if (index != null) {
      _transcript[index].text += delta;
    } else {
      final item = TranscriptItem(
        id: _nextId++,
        role: TranscriptRole.agent,
        text: delta,
        isStreaming: true,
      );
      _streamingAgentId = item.id;
      _transcript.add(item);
    }
  }

  void _finalizeAgentItem(String? text) {
    final index = _indexOf(_streamingAgentId);
    _streamingAgentId = null;
    if (index == null) return;
    if (text != null && text.isNotEmpty) _transcript[index].text = text;
    _transcript[index].isStreaming = false;
  }

  void _appendUserDelta(String delta) {
    if (delta.isEmpty) return;
    final index = _indexOf(_streamingUserId);
    if (index != null) {
      _transcript[index].text = reconcileTranscript(_transcript[index].text, delta);
    } else {
      final item = TranscriptItem(
        id: _nextId++,
        role: TranscriptRole.user,
        text: delta,
        isStreaming: true,
      );
      _streamingUserId = item.id;
      _transcript.add(item);
    }
  }

  /// Some STT providers (e.g. Soniox) emit each partial as the FULL text-so-far
  /// rather than an incremental chunk, so blindly appending duplicates the
  /// transcript. Tolerate both shapes; the final `completed` transcript is
  /// authoritative regardless.
  static String reconcileTranscript(String existing, String delta) {
    if (existing.isEmpty) return delta;
    if (delta == existing) return existing; // cumulative re-send of same text
    if (delta.startsWith(existing)) return delta; // cumulative growth → replace
    if (existing.startsWith(delta)) return existing; // stale shorter snapshot → keep
    return existing + delta; // genuine incremental chunk → append
  }

  void _finalizeUserItem(String transcript) {
    final trimmed = transcript.trim();
    final index = _indexOf(_streamingUserId);
    if (index != null) {
      if (trimmed.isNotEmpty) {
        _transcript[index].text = trimmed;
        _transcript[index].isStreaming = false;
      } else if (_transcript[index].text.isEmpty) {
        _transcript.removeAt(index);
      } else {
        _transcript[index].isStreaming = false;
      }
      _streamingUserId = null;
    } else if (trimmed.isNotEmpty) {
      _transcript.add(TranscriptItem(
        id: _nextId++,
        role: TranscriptRole.user,
        text: trimmed,
      ));
    }
  }

  void _dropStreamingAgentItem() {
    final id = _streamingAgentId;
    if (id != null) {
      _transcript.removeWhere((item) => item.id == id);
      _streamingAgentId = null;
    }
  }

  int? _indexOf(int? id) {
    if (id == null) return null;
    final index = _transcript.indexWhere((item) => item.id == id);
    return index >= 0 ? index : null;
  }
}
