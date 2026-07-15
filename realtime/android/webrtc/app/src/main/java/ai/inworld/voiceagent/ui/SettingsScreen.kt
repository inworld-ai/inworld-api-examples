package ai.inworld.voiceagent.ui

import ai.inworld.voiceagent.audio.AudioMode
import ai.inworld.voiceagent.state.CatalogViewModel
import ai.inworld.voiceagent.storage.AuthMode
import ai.inworld.voiceagent.storage.DeciderKind
import ai.inworld.voiceagent.storage.NoiseReductionMode
import ai.inworld.voiceagent.storage.Settings
import ai.inworld.voiceagent.storage.SettingsCatalog
import ai.inworld.voiceagent.storage.SettingsRepository
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    settingsRepository: SettingsRepository,
    catalogViewModel: CatalogViewModel,
    liveAudioDescription: (Boolean) -> String,
    onBack: () -> Unit,
) {
    val settings by settingsRepository.settings.collectAsStateWithLifecycle(initialValue = Settings())
    val scope = rememberCoroutineScope()
    var showsModelPicker by remember { mutableStateOf(false) }
    var showsVoicePicker by remember { mutableStateOf(false) }

    fun update(transform: (Settings) -> Settings) {
        scope.launch { settingsRepository.update(transform) }
    }

    Scaffold(
        topBar = {
            CenterAlignedTopAppBar(
                title = { Text("Settings") },
                navigationIcon = { IconButton(onClick = onBack) { Text("←") } },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
        ) {
            SectionHeader("Authentication")
            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                AuthMode.entries.forEachIndexed { index, mode ->
                    SegmentedButton(
                        selected = settings.authMode == mode,
                        onClick = { update { it.copy(authMode = mode) } },
                        shape = SegmentedButtonDefaults.itemShape(index, AuthMode.entries.size),
                    ) { Text(mode.label) }
                }
            }
            when (settings.authMode) {
                AuthMode.Basic -> SettingTextField(
                    label = "Inworld API Key (base64)",
                    value = settings.apiKey,
                    secure = true,
                ) { v -> update { it.copy(apiKey = v) } }
                AuthMode.BackendJwt -> SettingTextField(
                    label = "Backend URL",
                    value = settings.backendUrl,
                ) { v -> update { it.copy(backendUrl = v) } }
            }

            SectionHeader("Model")
            SettingTextField("LLM model", settings.model) { v -> update { it.copy(model = v) } }
            TextButton(onClick = { showsModelPicker = true }) { Text("Browse available models") }
            SwitchRow("Google web search", settings.webSearchEnabled) { v ->
                update { it.copy(webSearchEnabled = v) }
            }
            SwitchRow("Custom temperature", settings.temperatureEnabled) { v ->
                update { it.copy(temperatureEnabled = v) }
            }
            if (settings.temperatureEnabled) {
                SettingSlider("Temperature", settings.temperature, 0f..2f, format = "%.1f") { v ->
                    update { it.copy(temperature = v) }
                }
            }
            StepperRow("Max tokens", settings.maxOutputTokens, step = 256, range = 0..4096, zeroLabel = "default") { v ->
                update { it.copy(maxOutputTokens = v) }
            }

            SectionHeader("Voice Output")
            SettingTextField("TTS model", settings.ttsModel) { v -> update { it.copy(ttsModel = v) } }
            SettingTextField("Voice", settings.voice) { v -> update { it.copy(voice = v) } }
            TextButton(onClick = { showsVoicePicker = true }) { Text("Browse available voices") }
            SettingSlider("Speed", settings.speechSpeed, 0.5f..1.5f, format = "%.2f×") { v ->
                update { it.copy(speechSpeed = v) }
            }

            SectionHeader("Audio Input")
            OptionPickerRow(
                label = "Transcription",
                options = SettingsCatalog.transcriptionModels,
                selected = settings.transcriptionModel,
                display = { it.ifEmpty { "Server default" } },
            ) { v -> update { it.copy(transcriptionModel = v) } }
            SettingTextField("Language (e.g. en, optional)", settings.transcriptionLanguage) { v ->
                update { it.copy(transcriptionLanguage = v) }
            }
            OptionPickerRow(
                label = "Noise reduction",
                options = NoiseReductionMode.entries,
                selected = settings.noiseReduction,
                display = { it.label },
            ) { v -> update { it.copy(noiseReduction = v) } }

            SectionHeader("Turn Detection")
            OptionPickerRow(
                label = "Eagerness",
                options = SettingsCatalog.eagernessOptions,
                selected = settings.eagerness,
                display = { it.replaceFirstChar(Char::uppercase) },
            ) { v -> update { it.copy(eagerness = v) } }
            SwitchRow("Auto-create response", settings.createResponse) { v ->
                update { it.copy(createResponse = v) }
            }
            SwitchRow("Allow interruptions", settings.interruptResponse) { v ->
                update { it.copy(interruptResponse = v) }
            }

            SectionHeader("Back-channel")
            SwitchRow("Enable back-channel", settings.backchannelEnabled) { v ->
                update { it.copy(backchannelEnabled = v) }
            }
            if (settings.backchannelEnabled) {
                OptionPickerRow(
                    label = "Decider",
                    options = DeciderKind.entries,
                    selected = settings.bcDeciderKind,
                    display = { it.label },
                ) { v -> update { it.copy(bcDeciderKind = v) } }
                if (settings.bcDeciderKind == DeciderKind.Rule) {
                    SettingSlider("Fire probability", settings.bcRuleFireProbability, 0f..1f, format = "%.2f") { v ->
                        update { it.copy(bcRuleFireProbability = v) }
                    }
                }
                StepperRow("Max per turn", settings.bcMaxPerTurn, 1, 1..10) { v ->
                    update { it.copy(bcMaxPerTurn = v) }
                }
                StepperRow("Min gap (ms)", settings.bcMinGapMs, 500, 0..10000) { v ->
                    update { it.copy(bcMinGapMs = v) }
                }
                StepperRow("Min speech (ms)", settings.bcMinSpeechMs, 100, 0..5000) { v ->
                    update { it.copy(bcMinSpeechMs = v) }
                }
                SettingSlider("Volume gain", settings.bcVolumeGain, 0f..1f, format = "%.2f") { v ->
                    update { it.copy(bcVolumeGain = v) }
                }
            }
            SectionFooter("Brief acknowledgements (“uh-huh”, “right”) emitted while you are speaking.")

            SectionHeader("Responsiveness")
            SwitchRow("Enable responsiveness", settings.responsivenessEnabled) { v ->
                update { it.copy(responsivenessEnabled = v) }
            }
            if (settings.responsivenessEnabled) {
                StepperRow("Initial wait (ms)", settings.respInitialWaitMs, 100, 0..5000) { v ->
                    update { it.copy(respInitialWaitMs = v) }
                }
                StepperRow("Max initial per turn", settings.respMaxInitialPerTurn, 1, 0..5) { v ->
                    update { it.copy(respMaxInitialPerTurn = v) }
                }
                StepperRow("Min filler gap (ms)", settings.respMinFillerGapMs, 1000, 0..20000) { v ->
                    update { it.copy(respMinFillerGapMs = v) }
                }
                StepperRow("Max tokens", settings.respMaxTokens, 1, 1..50) { v ->
                    update { it.copy(respMaxTokens = v) }
                }
                SwitchRow("Allow on first reply", settings.respEnableOnFirstReply) { v ->
                    update { it.copy(respEnableOnFirstReply = v) }
                }
            }
            SectionFooter("Low-latency filler spoken before the main answer while the model is still thinking.")

            SectionHeader("Instructions")
            SettingTextField("System instructions", settings.instructions, singleLine = false) { v ->
                update { it.copy(instructions = v) }
            }
            SettingTextField("Greeting prompt", settings.greetingPrompt, singleLine = false) { v ->
                update { it.copy(greetingPrompt = v) }
            }

            SectionHeader("Audio (debug)")
            SwitchRow("Hardware AEC + NS", settings.useHardwareAec) { v ->
                update { it.copy(useHardwareAec = v) }
            }
            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                AudioMode.entries.forEachIndexed { index, mode ->
                    SegmentedButton(
                        selected = settings.audioMode == mode,
                        onClick = { update { it.copy(audioMode = mode) } },
                        shape = SegmentedButtonDefaults.itemShape(index, AudioMode.entries.size),
                    ) { Text(if (mode == AudioMode.InCommunication) "IN_COMM" else "NORMAL") }
                }
            }
            Text(
                text = liveAudioDescription(settings.useHardwareAec),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 8.dp),
            )
            SectionFooter(
                "Echo-repro levers. Defaults (IN_COMMUNICATION + HW AEC) are echo-free. " +
                    "Switch to NORMAL / AEC off to disable voice processing. Applied on next Connect.",
            )
        }
    }

    if (showsModelPicker) {
        ModelPickerSheet(
            catalogViewModel = catalogViewModel,
            onSelect = { v ->
                update { it.copy(model = v) }
                showsModelPicker = false
            },
            onDismiss = { showsModelPicker = false },
        )
    }
    if (showsVoicePicker) {
        VoicePickerSheet(
            catalogViewModel = catalogViewModel,
            onSelect = { v ->
                update { it.copy(voice = v) }
                showsVoicePicker = false
            },
            onDismiss = { showsVoicePicker = false },
        )
    }
}

@Composable
private fun SectionHeader(title: String) {
    HorizontalDivider(modifier = Modifier.padding(vertical = 12.dp))
    Text(
        text = title,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(bottom = 8.dp),
    )
}

@Composable
private fun SectionFooter(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(top = 4.dp),
    )
}

@Composable
private fun SettingTextField(
    label: String,
    value: String,
    secure: Boolean = false,
    singleLine: Boolean = true,
    onChange: (String) -> Unit,
) {
    // Buffer locally while focused: driving the field straight from the
    // DataStore flow drops keystrokes that race the async write round-trip.
    var text by remember { mutableStateOf(value) }
    var focused by remember { mutableStateOf(false) }
    if (!focused && text != value) text = value
    OutlinedTextField(
        value = text,
        onValueChange = {
            text = it
            onChange(it)
        },
        label = { Text(label) },
        singleLine = singleLine,
        visualTransformation = if (secure) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        keyboardOptions = if (secure) KeyboardOptions(keyboardType = KeyboardType.Password) else KeyboardOptions.Default,
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp)
            .onFocusChanged { focused = it.isFocused },
    )
}

@Composable
private fun SwitchRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, modifier = Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

@Composable
private fun SettingSlider(
    label: String,
    value: Double,
    range: ClosedFloatingPointRange<Float>,
    format: String,
    onChange: (Double) -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.fillMaxWidth()) {
            Text(label, modifier = Modifier.weight(1f))
            Text(
                String.format(java.util.Locale.US, format, value),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Slider(
            value = value.toFloat(),
            onValueChange = { onChange((it * 100).toInt() / 100.0) },
            valueRange = range,
        )
    }
}

@Composable
private fun StepperRow(
    label: String,
    value: Int,
    step: Int,
    range: IntRange,
    zeroLabel: String? = null,
    onChange: (Int) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            "$label: ${if (value == 0 && zeroLabel != null) zeroLabel else value}",
            modifier = Modifier.weight(1f),
        )
        OutlinedButton(onClick = { onChange((value - step).coerceIn(range)) }) { Text("−") }
        Spacer(Modifier.width(8.dp))
        OutlinedButton(onClick = { onChange((value + step).coerceIn(range)) }) { Text("+") }
    }
}

@Composable
private fun <T> OptionPickerRow(
    label: String,
    options: List<T>,
    selected: T,
    display: (T) -> String,
    onSelect: (T) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, modifier = Modifier.weight(1f))
        androidx.compose.foundation.layout.Box {
            OutlinedButton(onClick = { expanded = true }) { Text(display(selected)) }
            androidx.compose.material3.DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                options.forEach { option ->
                    androidx.compose.material3.DropdownMenuItem(
                        text = { Text(display(option)) },
                        onClick = {
                            onSelect(option)
                            expanded = false
                        },
                    )
                }
            }
        }
    }
}
