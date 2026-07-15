package ai.inworld.voiceagent.ui

import ai.inworld.voiceagent.state.ConversationUiState
import ai.inworld.voiceagent.state.SessionState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledIconToggleButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

// Minimal inline glyphs to avoid the material-icons dependency.
@Composable
private fun MicIcon(muted: Boolean) {
    Text(if (muted) "🔇" else "🎙️")
}

@Composable
fun ConnectionControls(
    state: ConversationUiState,
    liveAudioDescription: String?,
    onConnect: () -> Unit,
    onDisconnect: () -> Unit,
    onMicMutedChange: (Boolean) -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth().padding(16.dp)) {
        state.errorMessage?.let { error ->
            Text(
                text = error,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(bottom = 8.dp),
            )
        }
        if (state.isConnected && liveAudioDescription != null) {
            Text(
                text = liveAudioDescription,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = 8.dp),
            )
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            AssistChip(
                onClick = {},
                label = {
                    Text(
                        when (state.sessionState) {
                            SessionState.Idle -> "Disconnected"
                            SessionState.Connecting -> "Connecting…"
                            SessionState.Connected -> "Connected"
                            is SessionState.Failed -> "Error"
                        },
                    )
                },
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (state.isConnected) {
                    FilledIconToggleButton(
                        checked = state.isMicMuted,
                        onCheckedChange = onMicMutedChange,
                    ) {
                        MicIcon(muted = state.isMicMuted)
                    }
                    Spacer(Modifier.width(12.dp))
                }
                val active = state.isConnected || state.isBusy
                Button(
                    onClick = { if (active) onDisconnect() else onConnect() },
                    colors = if (active) ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.error,
                    ) else ButtonDefaults.buttonColors(),
                ) {
                    Text(if (active) "Disconnect" else "Connect")
                }
            }
        }
    }
}
