const SOUND_ENABLED_KEY = "aggregationScanSoundsEnabled";

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    if (!audioContext) {
      audioContext = new AudioContext();
    }
    if (audioContext.state === "suspended") {
      void audioContext.resume();
    }
    return audioContext;
  } catch {
    return null;
  }
}

function playTone(frequency: number, durationMs: number, type: OscillatorType = "sine"): void {
  const ctx = getAudioContext();
  if (!ctx) {
    return;
  }
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gain.gain.value = 0.12;
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  const now = ctx.currentTime;
  oscillator.start(now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + durationMs / 1000);
  oscillator.stop(now + durationMs / 1000);
}

export function isScanSoundsEnabled(): boolean {
  const stored = localStorage.getItem(SOUND_ENABLED_KEY);
  if (stored === null) {
    return true;
  }
  return stored === "1";
}

export function setScanSoundsEnabled(enabled: boolean): void {
  localStorage.setItem(SOUND_ENABLED_KEY, enabled ? "1" : "0");
}

export function playScanSuccessSound(): void {
  if (!isScanSoundsEnabled()) {
    return;
  }
  playTone(880, 80, "sine");
}

export function playScanErrorSound(): void {
  if (!isScanSoundsEnabled()) {
    return;
  }
  playTone(220, 120, "square");
  window.setTimeout(() => playTone(180, 120, "square"), 140);
}

/** Завершение набора / привязка КИТУ (режим «после сборки»). */
export function playScanCompleteSound(): void {
  if (!isScanSoundsEnabled()) {
    return;
  }
  playTone(523, 90, "sine");
  window.setTimeout(() => playTone(659, 90, "sine"), 100);
  window.setTimeout(() => playTone(784, 140, "sine"), 200);
}
