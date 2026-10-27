/** Playback state, independent of the DOM and Google SDK. */
export class Playback {
  steps = [];
  timer = undefined;
  index = 0;
  intervalMs = 1000;
  playing = false;
  token = 0; // bumped on pause/seek/load to cancel an in-flight turn
  turning = false;

  /**
   * @param onChange (index, step, playing) => void
   * @param turn optional async (from, to, isCancelled) => void, run in the current
   *   panorama before jumping to the next one (used to rotate the camera first).
   */
  constructor(onChange, turn = null) {
    this.onChange = onChange;
    this.turn = turn;
    this.hasMore = () => false; // true while more steps may still load
  }

  get length() { return this.steps.length; }

  /** `steps` may keep growing (same array); set hasMore to say whether it will. */
  load(steps, hasMore = () => false) {
    this.pause();
    this.steps = steps;
    this.hasMore = hasMore;
    this.index = 0;
    if (steps.length) this.emit();
  }

  play() {
    if (this.playing || !this.steps.length) return;
    if (this.index >= this.steps.length - 1 && !this.hasMore()) this.index = 0;
    this.playing = true;
    this.emit();
    this.schedule();
  }

  pause() {
    this.playing = false;
    this.token++;
    clearTimeout(this.timer);
    if (this.steps.length) this.emit();
  }

  toggle() { this.playing ? this.pause() : this.play(); }

  seek(i) {
    if (!this.steps.length) return;
    this.token++;
    this.index = Math.max(0, Math.min(this.steps.length - 1, i));
    this.emit();
  }

  step(delta) {
    if (delta === 1) this.forward();
    else this.seek(this.index + delta);
  }

  /** Move to the next step, first turning the camera in the current panorama if needed. */
  async forward() {
    const to = this.steps[this.index + 1];
    if (!to || this.turning) return false;
    const t = this.token;
    if (this.turn) {
      this.turning = true;
      try { await this.turn(this.steps[this.index], to, () => t !== this.token); }
      finally { this.turning = false; }
      if (t !== this.token) return false;
    }
    this.index++;
    this.emit();
    return true;
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      if (!this.playing) return;
      if (this.index >= this.steps.length - 1) {
        // Wait for lazily loaded steps instead of stopping.
        if (this.hasMore()) { this.schedule(); return; }
        this.pause();
        return;
      }
      await this.forward();
      if (this.playing) this.schedule();
    }, this.intervalMs);
  }

  emit() { this.onChange(this.index, this.steps[this.index], this.playing); }
}
