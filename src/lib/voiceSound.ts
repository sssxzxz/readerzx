let audio: AudioContext | null = null;
export function prepareVoiceSound() {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume().catch(() => {});
  } catch { /* Audio availability must not prevent voice commands. */ }
}
export async function playVoiceSuccess() {
  try {
    prepareVoiceSound();
    if (!audio) return;
    if (audio.state === 'suspended') await audio.resume();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const now = audio.currentTime;
    oscillator.frequency.setValueAtTime(880, now);
    oscillator.frequency.setValueAtTime(1175, now + 0.06);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.07, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.16);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  } catch { /* No device or muted output: the command still succeeded. */ }
}
