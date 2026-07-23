import 'dart:async';

/// Waits for ICE gathering: resolves on `complete`, 500 ms of candidate silence,
/// or a 3 s cap — mirroring the JS example. Candidates accumulate inside the peer
/// connection's local description, so only the wait matters.
class IceGatheringWaiter {
  final Completer<void> _completer = Completer<void>();
  Timer? _debounce;
  Timer? _timeout;

  Future<void> get done => _completer.future;

  void start() {
    _timeout = Timer(const Duration(seconds: 3), _finish);
  }

  void candidateGenerated() {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 500), _finish);
  }

  void gatheringComplete() => _finish();

  void _finish() {
    _debounce?.cancel();
    _timeout?.cancel();
    if (!_completer.isCompleted) _completer.complete();
  }
}
