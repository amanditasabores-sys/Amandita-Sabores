/**
 * Web Audio API synthesizer for crystal-clear, reliable alert chimes
 * without requiring external sound file assets or network requests.
 */
class SoundService {
  private audioCtx: AudioContext | null = null;
  private isSoundEnabled: boolean = true;
  private _newOrderVolume: number = 0.8; // 0.0 to 1.0 (default 80%)
  private _isNewOrderMuted: boolean = false;

  constructor() {
    // Check localStorage preference safely
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      try {
        const saved = localStorage.getItem('gestaofood_sound_enabled');
        if (saved !== null) {
          this.isSoundEnabled = saved === 'true';
        }
        const savedVol = localStorage.getItem('gf_new_order_volume');
        if (savedVol !== null) {
          const parsed = parseFloat(savedVol);
          if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
            this._newOrderVolume = parsed;
          }
        }
        const savedMuted = localStorage.getItem('gf_new_order_muted');
        if (savedMuted !== null) {
          this._isNewOrderMuted = savedMuted === 'true';
        }
      } catch {
        // fallback
      }
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

  public getNewOrderVolume(): number {
    return this._newOrderVolume;
  }

  public setNewOrderVolume(vol: number) {
    const clamped = Math.max(0, Math.min(1, vol));
    this._newOrderVolume = clamped;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('gf_new_order_volume', String(clamped));
    }
  }

  public isNewOrderMuted(): boolean {
    return this._isNewOrderMuted;
  }

  public setNewOrderMuted(muted: boolean) {
    this._isNewOrderMuted = muted;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('gf_new_order_muted', String(muted));
    }
  }

  /**
   * Força teste imediato do som no volume configurado (para botão 'Testar Som')
   */
  public testNewOrderAlert() {
    this.initContext();
    const effectiveVol = this._isNewOrderMuted ? 0.8 : this._newOrderVolume;
    this.playNewOrderTone(effectiveVol);
  }

  /**
   * Pleasant 3-note melodic doorbell chime for new orders:
   * E5 (659Hz) -> G#5 (830Hz) -> B5 (987Hz)
   */
  public playNewOrderAlert() {
    if (!this.isSoundEnabled || this._isNewOrderMuted || this._newOrderVolume <= 0) return;
    this.playNewOrderTone(this._newOrderVolume);
  }

  private playNewOrderTone(volume: number) {
    if (volume <= 0) return;
    try {
      this.initContext();
      if (!this.audioCtx) return;

      const now = this.audioCtx.currentTime;
      const notes = [
        { freq: 659.25, time: 0.0, duration: 0.22 },
        { freq: 830.61, time: 0.22, duration: 0.22 },
        { freq: 987.77, time: 0.44, duration: 0.45 },
      ];

      const peakGain = Math.max(0.005, 0.35 * volume);

      notes.forEach(({ freq, time, duration }) => {
        if (!this.audioCtx) return;
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + time);

        // Natural exponential decay envelope scaled by volume
        gain.gain.setValueAtTime(0.001, now + time);
        gain.gain.exponentialRampToValueAtTime(peakGain, now + time + 0.03);
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

  private persistentInterval: ReturnType<typeof setInterval> | null = null;
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
      clearInterval(this.persistentInterval);
    }

    // Set recurring timer
    this.persistentInterval = setInterval(() => {
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
      clearInterval(this.persistentInterval);
      this.persistentInterval = null;
    }
  }

  /**
   * Returns whether the persistent alert loop is currently active.
   */
  public isPersistentAlertActive(): boolean {
    return this.isAlertLooping;
  }

  /**
   * Distinct, upbeat 4-note ascending chime for orders ready for delivery:
   * D5 (587.33Hz) -> F#5 (739.99Hz) -> A5 (880.00Hz) -> D6 (1174.66Hz)
   */
  public playReadyOrderAlert() {
    if (!this.isSoundEnabled || this._isNewOrderMuted || this._newOrderVolume <= 0) return;
    try {
      this.initContext();
      if (!this.audioCtx) return;

      const now = this.audioCtx.currentTime;
      const notes = [
        { freq: 587.33, time: 0.0, duration: 0.16 }, // D5
        { freq: 739.99, time: 0.15, duration: 0.16 }, // F#5
        { freq: 880.00, time: 0.30, duration: 0.18 }, // A5
        { freq: 1174.66, time: 0.46, duration: 0.42 }, // D6
      ];

      const peakGain = Math.max(0.005, 0.35 * this._newOrderVolume);

      notes.forEach(({ freq, time, duration }) => {
        if (!this.audioCtx) return;
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + time);

        gain.gain.setValueAtTime(0.001, now + time);
        gain.gain.exponentialRampToValueAtTime(peakGain, now + time + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + time + duration);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc.start(now + time);
        osc.stop(now + time + duration);
      });
    } catch {
      // Audio might be blocked until user interacts with document
    }
  }

  private driverAlertInterval: ReturnType<typeof setInterval> | null = null;
  private isDriverAlertLooping: boolean = false;
  private driverAlertRepeatsRemaining: number = 0;

  /**
   * Starts a controlled driver alert chime that repeats up to maxRepeats times
   * (does not ring indefinitely) and can be stopped immediately via stopDriverReadyAlert().
   */
  public startDriverReadyAlert(intervalMs = 3500, maxRepeats = 4) {
    if (!this.isSoundEnabled || this._isNewOrderMuted) return;

    this.isDriverAlertLooping = true;
    this.driverAlertRepeatsRemaining = maxRepeats;

    // Play first chime immediately
    this.playReadyOrderAlert();
    this.driverAlertRepeatsRemaining--;

    // Clear any active timer
    if (this.driverAlertInterval) {
      clearInterval(this.driverAlertInterval);
    }

    // Set recurring timer with repeat limit
    this.driverAlertInterval = setInterval(() => {
      if (!this.isDriverAlertLooping || this.driverAlertRepeatsRemaining <= 0) {
        this.stopDriverReadyAlert();
        return;
      }
      this.playReadyOrderAlert();
      this.driverAlertRepeatsRemaining--;
    }, intervalMs);
  }

  /**
   * Immediately stops the driver ready order alert sound.
   */
  public stopDriverReadyAlert() {
    this.isDriverAlertLooping = false;
    this.driverAlertRepeatsRemaining = 0;
    if (this.driverAlertInterval) {
      clearInterval(this.driverAlertInterval);
      this.driverAlertInterval = null;
    }
  }

  /**
   * Checks if driver alert is actively ringing
   */
  public isDriverReadyAlertActive(): boolean {
    return this.isDriverAlertLooping;
  }
}

export const soundService = new SoundService();
