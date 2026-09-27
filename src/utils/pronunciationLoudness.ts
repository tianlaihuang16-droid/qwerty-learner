// Normalize only prepared word audio. The saved source file stays untouched so
// cached online recordings and Windows voices can always be replayed as-is.
const TARGET_ACTIVE_RMS = 0.12
const ACTIVE_FRAME_RMS = 0.01
const MAX_PEAK = 0.95
const MIN_GAIN = 0.35
const MAX_GAIN = 3
const MAX_DURATION_SECONDS = 12

export function normalizeAudioBuffer(buffer: Pick<AudioBuffer, 'numberOfChannels' | 'length' | 'sampleRate' | 'getChannelData'>): Blob | null {
  const channels = buffer.numberOfChannels
  if (channels < 1 || channels > 2 || buffer.sampleRate <= 0 || buffer.length <= 0 ||
    buffer.length / buffer.sampleRate > MAX_DURATION_SECONDS) return null
  const data = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel))
  const frameSize = Math.max(1, Math.round(buffer.sampleRate * 0.02))
  let activePower = 0
  let activeSamples = 0
  let peak = 0
  for (let start = 0; start < buffer.length; start += frameSize) {
    const end = Math.min(buffer.length, start + frameSize)
    let framePower = 0
    for (let index = start; index < end; index++) {
      for (const samples of data) {
        const value = samples[index]
        if (!Number.isFinite(value)) return null
        framePower += value * value
        peak = Math.max(peak, Math.abs(value))
      }
    }
    const count = (end - start) * channels
    if (Math.sqrt(framePower / count) >= ACTIVE_FRAME_RMS) {
      activePower += framePower
      activeSamples += count
    }
  }
  if (!activeSamples || peak === 0) return null
  const measuredRms = Math.sqrt(activePower / activeSamples)
  const desiredGain = Math.min(MAX_GAIN, Math.max(MIN_GAIN, TARGET_ACTIVE_RMS / measuredRms))
  const gain = Math.min(desiredGain, MAX_PEAK / peak)
  if (gain >= 0.9 && gain <= 1.1 && peak <= MAX_PEAK) return null

  const pcmBytes = buffer.length * channels * 2
  const output = new ArrayBuffer(44 + pcmBytes)
  const wav = new DataView(output)
  const label = (at: number, value: string) => {
    for (let index = 0; index < value.length; index++) wav.setUint8(at + index, value.charCodeAt(index))
  }
  label(0, 'RIFF')
  wav.setUint32(4, 36 + pcmBytes, true)
  label(8, 'WAVE')
  label(12, 'fmt ')
  wav.setUint32(16, 16, true)
  wav.setUint16(20, 1, true)
  wav.setUint16(22, channels, true)
  wav.setUint32(24, buffer.sampleRate, true)
  wav.setUint32(28, buffer.sampleRate * channels * 2, true)
  wav.setUint16(32, channels * 2, true)
  wav.setUint16(34, 16, true)
  label(36, 'data')
  wav.setUint32(40, pcmBytes, true)
  let offset = 44
  for (let index = 0; index < buffer.length; index++) {
    for (const samples of data) {
      const sample = Math.min(MAX_PEAK, Math.max(-MAX_PEAK, samples[index] * gain))
      wav.setInt16(offset, Math.round(sample * 32767), true)
      offset += 2
    }
  }
  return new Blob([output], { type: 'audio/wav' })
}

let decoder: AudioContext | undefined

export async function balancedPronunciationBlob(blob: Blob): Promise<Blob> {
  if (typeof AudioContext === 'undefined') return blob
  try {
    decoder ??= new AudioContext()
    const buffer = await decoder.decodeAudioData(await blob.arrayBuffer())
    return normalizeAudioBuffer(buffer) ?? blob
  } catch (error) {
    console.warn('Could not balance pronunciation loudness; using original audio', error)
    return blob
  }
}
