import SwiftUI

struct ConnectionControlsView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var conversation = model.conversation
        VStack(spacing: 10) {
            if let error = conversation.errorMessage {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }
            HStack(spacing: 16) {
                statusPill
                Spacer()
                if conversation.isConnected {
                    Button {
                        conversation.isMicMuted.toggle()
                    } label: {
                        Image(systemName: conversation.isMicMuted ? "mic.slash.fill" : "mic.fill")
                            .font(.title3)
                    }
                    .buttonStyle(.bordered)
                    .tint(conversation.isMicMuted ? .red : .accentColor)
                }
                connectButton
            }
        }
        .padding()
    }

    private var statusPill: some View {
        Label(statusText, systemImage: "circle.fill")
            .font(.caption)
            .foregroundStyle(statusColor)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(statusColor.opacity(0.12), in: Capsule())
    }

    private var statusText: String {
        switch model.conversation.state {
        case .idle: "Disconnected"
        case .connecting: "Connecting…"
        case .connected: "Connected"
        case .failed: "Error"
        }
    }

    private var statusColor: Color {
        switch model.conversation.state {
        case .idle: .secondary
        case .connecting: .orange
        case .connected: .green
        case .failed: .red
        }
    }

    private var connectButton: some View {
        Button {
            if model.conversation.isConnected || model.conversation.isBusy {
                model.conversation.disconnect()
            } else {
                Task { await model.conversation.connect() }
            }
        } label: {
            Text(model.conversation.isConnected || model.conversation.isBusy ? "Disconnect" : "Connect")
                .frame(minWidth: 100)
        }
        .buttonStyle(.borderedProminent)
        .tint(model.conversation.isConnected || model.conversation.isBusy ? .red : .accentColor)
    }
}
