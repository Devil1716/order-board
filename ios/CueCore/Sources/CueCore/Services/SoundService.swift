import Foundation
import AVFoundation

#if canImport(UIKit)
import UIKit
#endif

/// Audio synthesizer that replicates the exact two-tone sine wave chime from the web app:
/// 880 Hz followed by 1175 Hz with exponential decay.
public class SoundService: ObservableObject {
    public static let shared = SoundService()
    private let soundKey = "ob-sound"

    @Published public var isSoundEnabled: Bool {
        didSet {
            UserDefaults.standard.set(isSoundEnabled, forKey: soundKey)
        }
    }

    private var audioPlayer: AVAudioPlayer?
    private var cachedWavData: Data?

    public init() {
        self.isSoundEnabled = UserDefaults.standard.bool(forKey: "ob-sound")
        self.cachedWavData = Self.generateChimeWav()
    }

    public func toggleSound() {
        isSoundEnabled.toggle()
        if isSoundEnabled {
            chime()
        }
    }

    /// Plays the ready chime if sound is enabled
    public func chime() {
        guard isSoundEnabled else { return }

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            if self.cachedWavData == nil {
                self.cachedWavData = Self.generateChimeWav()
            }
            guard let wavData = self.cachedWavData else { return }

            do {
                #if os(iOS)
                try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
                try AVAudioSession.sharedInstance().setActive(true)
                #endif
                let player = try AVAudioPlayer(data: wavData)
                player.prepareToPlay()
                player.play()
                DispatchQueue.main.async {
                    self.audioPlayer = player
                }
            } catch {
                #if os(iOS)
                AudioServicesPlaySystemSound(1005) // Fallback standard system sound
                #endif
            }
        }
    }

    /// Generates a valid RIFF WAV PCM data buffer containing the exact 880 Hz + 1175 Hz chime
    private static func generateChimeWav() -> Data {
        let sampleRate: Double = 44100
        let totalDuration: Double = 0.75
        let totalSamples = Int(sampleRate * totalDuration)

        var samples = [Int16](repeating: 0, count: totalSamples)

        // Tone 1: 880 Hz, starts at 0.0s, lasts 0.5s
        let f1: Double = 880.0
        let t1Start: Double = 0.0
        let t1Dur: Double = 0.50

        // Tone 2: 1175 Hz, starts at 0.18s, lasts 0.5s
        let f2: Double = 1175.0
        let t2Start: Double = 0.18
        let t2Dur: Double = 0.50

        for i in 0..<totalSamples {
            let t = Double(i) / sampleRate
            var sampleVal: Double = 0.0

            // Tone 1 envelope
            if t >= t1Start && t < (t1Start + t1Dur) {
                let dt = t - t1Start
                // Attack: 0 to 0.02s ramp up to 0.3; decay: exponential to 0.5s
                let gain: Double
                if dt < 0.02 {
                    gain = 0.3 * (dt / 0.02)
                } else {
                    gain = 0.3 * exp(-5.0 * (dt - 0.02))
                }
                sampleVal += gain * sin(2.0 * .pi * f1 * dt)
            }

            // Tone 2 envelope
            if t >= t2Start && t < (t2Start + t2Dur) {
                let dt = t - t2Start
                let gain: Double
                if dt < 0.02 {
                    gain = 0.3 * (dt / 0.02)
                } else {
                    gain = 0.3 * exp(-5.0 * (dt - 0.02))
                }
                sampleVal += gain * sin(2.0 * .pi * f2 * dt)
            }

            // Clamp and convert to 16-bit signed integer
            let clamped = max(-1.0, min(1.0, sampleVal))
            samples[i] = Int16(clamped * 32767.0)
        }

        // Build RIFF header
        var data = Data()
        let numChannels: UInt16 = 1
        let bitsPerSample: UInt16 = 16
        let byteRate = UInt32(sampleRate) * UInt32(numChannels) * UInt32(bitsPerSample / 8)
        let blockAlign = numChannels * (bitsPerSample / 8)
        let subchunk2Size = UInt32(totalSamples * Int(blockAlign))
        let chunkSize = 36 + subchunk2Size

        data.append(contentsOf: [0x52, 0x49, 0x46, 0x46]) // "RIFF"
        data.append(withUnsafeBytes(of: chunkSize.littleEndian) { Data($0) })
        data.append(contentsOf: [0x57, 0x41, 0x56, 0x45]) // "WAVE"
        data.append(contentsOf: [0x66, 0x6D, 0x74, 0x20]) // "fmt "
        data.append(withUnsafeBytes(of: UInt32(16).littleEndian) { Data($0) }) // Subchunk1Size
        data.append(withUnsafeBytes(of: UInt16(1).littleEndian) { Data($0) })  // AudioFormat (PCM)
        data.append(withUnsafeBytes(of: numChannels.littleEndian) { Data($0) })
        data.append(withUnsafeBytes(of: UInt32(sampleRate).littleEndian) { Data($0) })
        data.append(withUnsafeBytes(of: byteRate.littleEndian) { Data($0) })
        data.append(withUnsafeBytes(of: blockAlign.littleEndian) { Data($0) })
        data.append(withUnsafeBytes(of: bitsPerSample.littleEndian) { Data($0) })
        data.append(contentsOf: [0x64, 0x61, 0x74, 0x61]) // "data"
        data.append(withUnsafeBytes(of: subchunk2Size.littleEndian) { Data($0) })

        samples.withUnsafeBufferPointer { buffer in
            data.append(Data(buffer: buffer))
        }

        return data
    }
}
