import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var showsModelPicker = false
    @State private var showsVoicePicker = false

    var body: some View {
        @Bindable var settings = model.settings
        NavigationStack {
            Form {
                authSection($settings)
                modelSection($settings)
                voiceSection($settings)
                inputSection($settings)
                turnDetectionSection($settings)
                backchannelSection($settings)
                responsivenessSection($settings)
                instructionsSection($settings)
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .sheet(isPresented: $showsModelPicker) {
                ModelPickerView(selection: $settings.model)
            }
            .sheet(isPresented: $showsVoicePicker) {
                VoicePickerView(selection: $settings.voice)
            }
        }
    }

    private func authSection(_ settings: Bindable<SettingsStore>) -> some View {
        Section("Authentication") {
            Picker("Mode", selection: settings.authMode) {
                ForEach(AuthMode.allCases) { mode in
                    Text(mode.label).tag(mode)
                }
            }
            switch settings.wrappedValue.authMode {
            case .basic:
                SecureField("Inworld API Key (base64)", text: settings.apiKey)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            case .backendJWT:
                TextField("Backend URL", text: settings.backendURL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
            }
        }
    }

    private func modelSection(_ settings: Bindable<SettingsStore>) -> some View {
        Section("Model") {
            TextField("LLM model", text: settings.model)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button {
                showsModelPicker = true
            } label: {
                Label("Browse available models", systemImage: "list.bullet")
            }
            Toggle("Google web search", isOn: settings.webSearchEnabled)
            Toggle("Custom temperature", isOn: settings.temperatureEnabled)
            if settings.wrappedValue.temperatureEnabled {
                LabeledSlider(
                    label: "Temperature",
                    value: settings.temperature,
                    range: 0...2,
                    step: 0.1,
                    format: "%.1f"
                )
            }
            Stepper(
                settings.wrappedValue.maxOutputTokens > 0
                    ? "Max tokens: \(settings.wrappedValue.maxOutputTokens)"
                    : "Max tokens: default",
                value: settings.maxOutputTokens,
                in: 0...4096,
                step: 256
            )
        }
    }

    private func voiceSection(_ settings: Bindable<SettingsStore>) -> some View {
        Section("Voice Output") {
            TextField("TTS model", text: settings.ttsModel)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            TextField("Voice", text: settings.voice)
                .autocorrectionDisabled()
            Button {
                showsVoicePicker = true
            } label: {
                Label("Browse available voices", systemImage: "person.wave.2")
            }
            LabeledSlider(
                label: "Speed",
                value: settings.speechSpeed,
                range: 0.25...1.5,
                step: 0.05,
                format: "%.2f×"
            )
        }
    }

    private func inputSection(_ settings: Bindable<SettingsStore>) -> some View {
        Section("Audio Input") {
            Picker("Transcription", selection: settings.transcriptionModel) {
                ForEach(SettingsCatalog.transcriptionModels, id: \.self) { model in
                    Text(model.isEmpty ? "Server default" : model).tag(model)
                }
            }
            TextField("Language (e.g. en, optional)", text: settings.transcriptionLanguage)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Picker("Noise reduction", selection: settings.noiseReduction) {
                ForEach(NoiseReductionMode.allCases) { mode in
                    Text(mode.label).tag(mode)
                }
            }
        }
    }

    private func turnDetectionSection(_ settings: Bindable<SettingsStore>) -> some View {
        Section {
            Picker("Type", selection: settings.turnDetectionMode) {
                ForEach(TurnDetectionMode.allCases) { mode in
                    Text(mode.label).tag(mode)
                }
            }
            switch settings.wrappedValue.turnDetectionMode {
            case .semanticVAD:
                Picker("Eagerness", selection: settings.eagerness) {
                    ForEach(SettingsCatalog.eagernessOptions, id: \.self) { option in
                        Text(option.capitalized).tag(option)
                    }
                }
            case .serverVAD:
                LabeledSlider(
                    label: "Threshold",
                    value: settings.vadThreshold,
                    range: 0...1,
                    step: 0.05,
                    format: "%.2f"
                )
                Stepper(
                    "Prefix padding: \(settings.wrappedValue.prefixPaddingMs) ms",
                    value: settings.prefixPaddingMs,
                    in: 0...2000,
                    step: 100
                )
                Stepper(
                    "Silence duration: \(settings.wrappedValue.silenceDurationMs) ms",
                    value: settings.silenceDurationMs,
                    in: 100...3000,
                    step: 100
                )
                Stepper(
                    settings.wrappedValue.idleTimeoutMs > 0
                        ? "Idle timeout: \(settings.wrappedValue.idleTimeoutMs) ms"
                        : "Idle timeout: off",
                    value: settings.idleTimeoutMs,
                    in: 0...30000,
                    step: 1000
                )
            }
            Toggle("Auto-create response", isOn: settings.createResponse)
            Toggle("Allow interruptions", isOn: settings.interruptResponse)
        } header: {
            Text("Turn Detection")
        } footer: {
            Text(settings.wrappedValue.turnDetectionMode == .semanticVAD
                 ? "Semantic VAD uses meaning to detect end of turn."
                 : "Server VAD uses audio levels and silence timing.")
        }
    }

    @ViewBuilder
    private func backchannelSection(_ settings: Bindable<SettingsStore>) -> some View {
        Section {
            Toggle("Enable back-channel", isOn: settings.backchannelEnabled)
            if settings.wrappedValue.backchannelEnabled {
                Picker("Decider", selection: settings.bcDeciderKind) {
                    ForEach(DeciderKind.allCases) { kind in
                        Text(kind.label).tag(kind)
                    }
                }
                if settings.wrappedValue.bcDeciderKind == .rule {
                    LabeledSlider(label: "Fire probability", value: settings.bcRuleFireProbability,
                                  range: 0...1, step: 0.05, format: "%.2f")
                }
                Stepper("Max per turn: \(settings.wrappedValue.bcMaxPerTurn)",
                        value: settings.bcMaxPerTurn, in: 1...10)
                Stepper("Min gap: \(settings.wrappedValue.bcMinGapMs) ms",
                        value: settings.bcMinGapMs, in: 0...10000, step: 500)
                Stepper("Min speech: \(settings.wrappedValue.bcMinSpeechMs) ms",
                        value: settings.bcMinSpeechMs, in: 0...5000, step: 100)
                LabeledSlider(label: "Volume gain", value: settings.bcVolumeGain,
                              range: 0...1, step: 0.05, format: "%.2f")
            }
        } header: {
            Text("Back-channel")
        } footer: {
            Text("Brief acknowledgements (\u{201C}uh-huh\u{201D}, \u{201C}right\u{201D}) emitted while you are speaking.")
        }
    }

    @ViewBuilder
    private func responsivenessSection(_ settings: Bindable<SettingsStore>) -> some View {
        Section {
            Toggle("Enable responsiveness", isOn: settings.responsivenessEnabled)
            if settings.wrappedValue.responsivenessEnabled {
                Stepper("Initial wait: \(settings.wrappedValue.respInitialWaitMs) ms",
                        value: settings.respInitialWaitMs, in: 0...5000, step: 100)
                Stepper("Max initial per turn: \(settings.wrappedValue.respMaxInitialPerTurn)",
                        value: settings.respMaxInitialPerTurn, in: 0...5)
                Stepper("Min filler gap: \(settings.wrappedValue.respMinFillerGapMs) ms",
                        value: settings.respMinFillerGapMs, in: 0...20000, step: 1000)
                Stepper("Max tokens: \(settings.wrappedValue.respMaxTokens)",
                        value: settings.respMaxTokens, in: 1...50)
                Toggle("Allow on first reply", isOn: settings.respEnableOnFirstReply)
            }
        } header: {
            Text("Responsiveness")
        } footer: {
            Text("Low-latency filler spoken before the main answer while the model is still thinking.")
        }
    }

    private func instructionsSection(_ settings: Bindable<SettingsStore>) -> some View {
        Section("Instructions") {
            TextField("System instructions", text: settings.instructions, axis: .vertical)
                .lineLimit(3...6)
            TextField("Greeting prompt", text: settings.greetingPrompt, axis: .vertical)
                .lineLimit(2...4)
        }
    }
}

private struct LabeledSlider: View {
    let label: String
    @Binding var value: Double
    let range: ClosedRange<Double>
    let step: Double
    let format: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label)
                Spacer()
                Text(String(format: format, value))
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            Slider(value: $value, in: range, step: step)
        }
    }
}
