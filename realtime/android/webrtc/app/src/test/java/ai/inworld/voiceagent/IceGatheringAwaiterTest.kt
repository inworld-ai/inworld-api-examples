package ai.inworld.voiceagent

import ai.inworld.voiceagent.webrtc.IceGatheringAwaiter
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class IceGatheringAwaiterTest {
    @Test
    fun returnsImmediatelyWhenAlreadyComplete() = runTest {
        IceGatheringAwaiter().await(alreadyComplete = true)
        assertEquals(0, currentTime)
    }

    @Test
    fun resolvesOnCompleteSignal() = runTest {
        val awaiter = IceGatheringAwaiter()
        awaiter.onGatheringComplete()
        awaiter.await()
        assertEquals(0, currentTime)
    }

    @Test
    fun resolvesAfterQuietPeriodFollowingLastCandidate() = runTest {
        val awaiter = IceGatheringAwaiter(capMs = 3_000, quietMs = 500)
        val job = launch { awaiter.await() }
        awaiter.onCandidate()
        testScheduler.advanceTimeBy(300)
        awaiter.onCandidate() // resets the quiet window
        testScheduler.advanceUntilIdle()
        job.join()
        // last candidate at t=300 + 500ms quiet = 800
        assertEquals(800, currentTime)
    }

    @Test
    fun capsAtHardTimeoutUnderContinuousCandidates() = runTest {
        val awaiter = IceGatheringAwaiter(capMs = 3_000, quietMs = 500)
        var completedAt = -1L
        val job = launch {
            awaiter.await()
            completedAt = currentTime
        }
        // A candidate every 400ms keeps the quiet window from ever elapsing.
        repeat(10) {
            testScheduler.advanceTimeBy(400)
            awaiter.onCandidate()
        }
        testScheduler.advanceUntilIdle()
        job.join()
        assertEquals("hard cap should bound the wait", 3_000, completedAt)
    }

    @Test
    fun resolvesOnCompleteEvenMidQuietWindow() = runTest {
        val awaiter = IceGatheringAwaiter(capMs = 3_000, quietMs = 500)
        val job = launch { awaiter.await() }
        awaiter.onCandidate()
        testScheduler.advanceTimeBy(100)
        awaiter.onGatheringComplete()
        testScheduler.advanceUntilIdle()
        job.join()
        assertEquals(100, currentTime)
    }
}
