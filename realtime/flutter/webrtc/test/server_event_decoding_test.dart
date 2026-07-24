import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:inworld_voice_agent/realtime/events/server_event.dart';

ServerEvent decode(Map<String, dynamic> obj) => ServerEvent.decode(jsonEncode(obj));

void main() {
  test('output text delta variants map to one case', () {
    for (final type in [
      'response.output_text.delta',
      'response.text.delta',
      'response.audio_transcript.delta',
      'response.output_audio_transcript.delta',
    ]) {
      final event = decode({'type': type, 'delta': 'hi'});
      expect(event, isA<OutputTextDelta>());
      expect((event as OutputTextDelta).delta, 'hi');
    }
  });

  test('transcript done from top-level and content_part', () {
    expect(
      (decode({'type': 'response.output_audio_transcript.done', 'transcript': 'done'})
              as TranscriptDone)
          .text,
      'done',
    );
    expect(
      (decode({
        'type': 'response.content_part.done',
        'part': {'transcript': 'part'},
      }) as TranscriptDone)
          .text,
      'part',
    );
  });

  test('input transcription delta and completed', () {
    expect(
      (decode({
        'type': 'conversation.item.input_audio_transcription.delta',
        'delta': 'ab',
      }) as InputTranscriptionDelta)
          .delta,
      'ab',
    );
    expect(
      (decode({
        'type': 'conversation.item.input_audio_transcription.completed',
        'transcript': 'final',
      }) as InputTranscriptionCompleted)
          .transcript,
      'final',
    );
  });

  test('lifecycle events', () {
    expect(decode({'type': 'input_audio_buffer.speech_started'}), isA<SpeechStarted>());
    expect(decode({'type': 'response.output_item.added'}), isA<OutputItemAdded>());
    expect(decode({'type': 'response.done'}), isA<ResponseDone>());
  });

  test('backchannel events', () {
    expect(
      (decode({'type': 'response.backchannel.audio.delta', 'delta': 'AAA='})
              as BackchannelAudioDelta)
          .base64Pcm16,
      'AAA=',
    );
    expect(
      (decode({'type': 'response.backchannel.audio.done', 'phrase': 'uh-huh'})
              as BackchannelAudioDone)
          .phrase,
      'uh-huh',
    );
    expect(
      (decode({'type': 'response.backchannel.skipped', 'reason': 'too soon'})
              as BackchannelSkipped)
          .reason,
      'too soon',
    );
  });

  test('error from nested and flat message', () {
    expect(
      (decode({
        'type': 'error',
        'error': {'message': 'nested'},
      }) as ErrorEvent)
          .message,
      'nested',
    );
    expect((decode({'type': 'error', 'message': 'flat'}) as ErrorEvent).message, 'flat');
  });

  test('unknown and malformed fall back to UnknownEvent', () {
    expect((decode({'type': 'something.new'}) as UnknownEvent).type, 'something.new');
    expect(ServerEvent.decode('not json'), isA<UnknownEvent>());
    expect(ServerEvent.decode('{}'), isA<UnknownEvent>());
  });
}
