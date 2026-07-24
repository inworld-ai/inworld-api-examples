import 'package:flutter_test/flutter_test.dart';
import 'package:inworld_voice_agent/state/conversation_controller.dart';

void main() {
  group('reconcileTranscript', () {
    test('empty existing returns delta', () {
      expect(ConversationController.reconcileTranscript('', 'hello'), 'hello');
    });

    test('cumulative re-send of same text is idempotent', () {
      expect(ConversationController.reconcileTranscript('hello', 'hello'), 'hello');
    });

    test('cumulative growth replaces', () {
      expect(
        ConversationController.reconcileTranscript('hello', 'hello world'),
        'hello world',
      );
    });

    test('stale shorter snapshot is ignored', () {
      expect(
        ConversationController.reconcileTranscript('hello world', 'hello'),
        'hello world',
      );
    });

    test('genuine incremental chunk appends', () {
      expect(
        ConversationController.reconcileTranscript('hello ', 'world'),
        'hello world',
      );
    });
  });
}
