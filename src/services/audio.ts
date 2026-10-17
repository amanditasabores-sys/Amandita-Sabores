/**
 * Web Audio API synthesizer for crystal-clear, reliable alert chimes
 * without requiring external sound file assets or network requests.
 */
class SoundService {
  private audioCtx: AudioContext | null = null;
  private isSoundEnabled: boolean = true;

  constructor() {
    // Check localStorage preference
    const saved = localStorage.getItem('gestaofood_sound_enabled');
    if (saved !== null) {
      this.isSoundEnabled = saved === 'true';
    }
  }

  private initContext() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  public isEnabled(): boolean {
    return this.isSoundEnabled;
  }

  public setEnabled(enabled: boolean) {
    this.isSoundEnabled = enabled;
    localStorage.setItem('gestaofood_sound_enabled', String(enabled));
  }

  /**
   * Pleasant 3-note melodic doorbell chime for new orders:
   * E5 (659Hz) -> G#5 (830Hz) -> B5 (987Hz)
   */
  public playNewOrderAlert() {
    if (!this.isSoundEnabled) return;
    try {
      this.initContext();
      if (!this.audioCtx) return;

      const now = this.audioCtx.currentTime;
      const notes = [
        { freq: 659.25, time: 0.0, duration: 0.22 },
        { freq: 830.61, time: 0.22, duration: 0.22 },
        { freq: 987.77, time: 0.44, duration: 0.45 },
      ];

      notes.forEach(({ freq, time, duration }) => {
        if (!this.audioCtx) return;
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + time);

        // Natural exponential decay envelope
        gain.gain.setValueAtTime(0.001, now + time);
        gain.gain.exponentialRampToValueAtTime(0.35, now + time + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + time + duration);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc.start(now + time);
        osc.stop(now + time + duration);
      });
    } catch {
      // Audio might be blocked until first user interaction
    }
  }

  /**
   * Action notification (success / kitchen dispatch / delivery)
   */
  public playSuccessTone() {
    if (!this.isSoundEnabled) return;
    try {
      this.initContext();
      if (!this.audioCtx) return;

      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.15); // G5

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      osc.connect(gain);
      osc.start(now);
      osc.stop(now + 0.25);
    } catch {
      // fallback
    }
  }

  private persistentInterval: number | null = null;
  private isAlertLooping: boolean = false;

  /**
   * Starts a persistent audio chime that repeats at regular intervals
   * until the operator explicitly stops/acknowledges it as seen.
   */
  public startPersistentOrderAlert(intervalMs = 3500) {
    if (!this.isSoundEnabled) return;
    this.isAlertLooping = true;
    
    // Play immediately
    this.playNewOrderAlert();

    // Clear any existing timer
    if (this.persistentInterval) {
      window.clearInterval(this.persistentInterval);
    }

    // Set recurring timer
    this.persistentInterval = window.setInterval(() => {
      if (this.isAlertLooping && this.isSoundEnabled) {
        this.playNewOrderAlert();
      }
    }, intervalMs);
  }

  /**
   * Stops the persistent repeating alert chime.
   */
  public stopPersistentOrderAlert() {
    this.isAlertLooping = false;
    if (this.persistentInterval) {
      window.clearInterval(this.persistentInterval);
      this.persistentInterval = null;
    }
  }

  /**
   * Check if persistent alert is actively ringing
   */
  public isPersistentAlertActive(): boolean {
    return this.isAlertLooping;
  }
}

export const soundService = new SoundService();
