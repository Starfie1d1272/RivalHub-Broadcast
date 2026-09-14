export class ReplayClock {
  #virtualElapsedUs = 0;

  get virtualElapsedUs(): number {
    return this.#virtualElapsedUs;
  }

  advanceTo(targetElapsedUs: number): void {
    if (!Number.isSafeInteger(targetElapsedUs) || targetElapsedUs < this.#virtualElapsedUs) {
      throw new RangeError('ReplayClock can only advance to a non-decreasing safe integer');
    }
    this.#virtualElapsedUs = targetElapsedUs;
  }
}
