import Foundation
import WebRTC

/// Waits for ICE gathering: resolves on `complete`, 500 ms of candidate silence,
/// or a 3 s cap — mirroring the JS example. Candidates accumulate inside the
/// peer connection's local description, so only the wait matters.
final class IceGatheringWaiter {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Void, Never>?
    private var debounceTask: Task<Void, Never>?
    private var timeoutTask: Task<Void, Never>?

    func wait(peerConnection: RTCPeerConnection) async {
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            lock.lock()
            continuation = cont
            lock.unlock()
            timeoutTask = Task { [weak self] in
                try? await Task.sleep(for: .seconds(3))
                guard !Task.isCancelled else { return }
                self?.finish()
            }
            if peerConnection.iceGatheringState == .complete {
                finish()
            }
        }
    }

    /// Called from the peer connection delegate (WebRTC signaling thread).
    func candidateGenerated() {
        lock.lock()
        debounceTask?.cancel()
        debounceTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(500))
            guard !Task.isCancelled else { return }
            self?.finish()
        }
        lock.unlock()
    }

    /// Called from the peer connection delegate (WebRTC signaling thread).
    func gatheringStateChanged(_ state: RTCIceGatheringState) {
        if state == .complete {
            finish()
        }
    }

    private func finish() {
        lock.lock()
        let cont = continuation
        continuation = nil
        debounceTask?.cancel()
        timeoutTask?.cancel()
        lock.unlock()
        cont?.resume()
    }
}
