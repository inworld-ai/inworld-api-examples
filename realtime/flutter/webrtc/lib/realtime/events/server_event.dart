import 'dart:convert';

/// Server → client events. A sealed hierarchy mirroring the native examples'
/// switch over the realtime event `type`.
sealed class ServerEvent {
  const ServerEvent();

  static ServerEvent decode(String raw) {
    final Map<String, dynamic> obj;
    try {
      obj = jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      return const UnknownEvent('');
    }
    final type = obj['type'] as String?;
    if (type == null) return const UnknownEvent('');

    switch (type) {
      case 'response.output_text.delta':
      case 'response.text.delta':
      case 'response.audio_transcript.delta':
      case 'response.output_audio_transcript.delta':
        return OutputTextDelta(obj['delta'] as String? ?? '');
      case 'response.output_audio_transcript.done':
        return TranscriptDone(obj['transcript'] as String?);
      case 'response.content_part.done':
        final part = obj['part'] as Map<String, dynamic>?;
        return TranscriptDone(part?['transcript'] as String?);
      case 'conversation.item.input_audio_transcription.delta':
        return InputTranscriptionDelta(obj['delta'] as String? ?? '');
      case 'conversation.item.input_audio_transcription.completed':
        return InputTranscriptionCompleted(obj['transcript'] as String? ?? '');
      case 'input_audio_buffer.speech_started':
        return const SpeechStarted();
      case 'response.output_item.added':
        return const OutputItemAdded();
      case 'response.done':
        return const ResponseDone();
      case 'response.backchannel.audio.delta':
        return BackchannelAudioDelta(obj['delta'] as String? ?? '');
      case 'response.backchannel.audio.done':
        return BackchannelAudioDone(obj['phrase'] as String?);
      case 'response.backchannel.skipped':
        return BackchannelSkipped(obj['reason'] as String? ?? '');
      case 'error':
        final error = obj['error'] as Map<String, dynamic>?;
        final message = error?['message'] as String? ??
            obj['message'] as String? ??
            'unknown error';
        return ErrorEvent(message);
      default:
        return UnknownEvent(type);
    }
  }
}

class OutputTextDelta extends ServerEvent {
  const OutputTextDelta(this.delta);
  final String delta;
}

class TranscriptDone extends ServerEvent {
  const TranscriptDone(this.text);
  final String? text;
}

class InputTranscriptionDelta extends ServerEvent {
  const InputTranscriptionDelta(this.delta);
  final String delta;
}

class InputTranscriptionCompleted extends ServerEvent {
  const InputTranscriptionCompleted(this.transcript);
  final String transcript;
}

class SpeechStarted extends ServerEvent {
  const SpeechStarted();
}

class OutputItemAdded extends ServerEvent {
  const OutputItemAdded();
}

class ResponseDone extends ServerEvent {
  const ResponseDone();
}

class BackchannelAudioDelta extends ServerEvent {
  const BackchannelAudioDelta(this.base64Pcm16);
  final String base64Pcm16;
}

class BackchannelAudioDone extends ServerEvent {
  const BackchannelAudioDone(this.phrase);
  final String? phrase;
}

class BackchannelSkipped extends ServerEvent {
  const BackchannelSkipped(this.reason);
  final String reason;
}

class ErrorEvent extends ServerEvent {
  const ErrorEvent(this.message);
  final String message;
}

class UnknownEvent extends ServerEvent {
  const UnknownEvent(this.type);
  final String type;
}
