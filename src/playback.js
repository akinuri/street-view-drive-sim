/** Playback state, independent of the DOM and Google SDK. */
export class Playback {
  steps = [];
  timer = undefined;
  index = 0;
  intervalMs = 1000;
  playing = false;

  /** @param onChange (index, step, playing) => void */
  constructor(onChange) {
    this.onChange = onChange;
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
    clearTimeout(this.timer);
    if (this.steps.length) this.emit();
  }

  toggle() { this.playing ? this.pause() : this.play(); }

  seek(i) {
    if (!this.steps.length) return;
    this.index = Math.max(0, Math.min(this.steps.length - 1, i));
    this.emit();
  }

  step(delta) { this.seek(this.index + delta); }

  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (!this.playing) return;
      if (this.index >= this.steps.length - 1) {
        // Wait for lazily loaded steps instead of stopping.
        if (this.hasMore()) { this.schedule(); return; }
        this.pause();
        return;
      }
      this.index++;
      this.emit();
      this.schedule();
    }, this.intervalMs);
  }

  emit() { this.onChange(this.index, this.steps[this.index], this.playing); }
}
