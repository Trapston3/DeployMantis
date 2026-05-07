/**
 * @typedef {Object} TemporalSnapshot
 * @property {number} capacity - The maximum number of frames the buffer can hold.
 * @property {number} currentSize - The current number of frames in the buffer.
 * @property {Array<any>} frames - The ordered array of frames, oldest first.
 */

export class TemporalDebugger {
  /**
   * Initializes the TemporalDebugger circular buffer.
   * Reads the capacity from process.env.STRATA_BUFFER_SIZE or defaults to 50.
   */
  constructor() {
    /** @type {number} */
    this.capacity = parseInt(process.env.STRATA_BUFFER_SIZE || "50", 10);
    if (isNaN(this.capacity) || this.capacity <= 0) {
      this.capacity = 50;
    }

    /** @type {Array<any>} */
    this.buffer = new Array(this.capacity);
    /** @type {number} */
    this.head = 0;
    /** @type {number} */
    this.count = 0;
  }

  /**
   * Adds a new frame to the circular buffer.
   * If the buffer is at capacity, the oldest frame is overwritten.
   * @param {any} frameData - The data object representing the current state frame.
   */
  push(frameData) {
    this.buffer[this.head] = frameData;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  /**
   * Retrieves a specific frame by its logical index (0 is oldest).
   * @param {number} index - The logical index of the frame.
   * @returns {any|null} The frame data, or null if the index is out of bounds.
   */
  getFrame(index) {
    if (index < 0 || index >= this.count) {
      return null;
    }
    // Calculate the physical index in the circular buffer
    // Oldest element is at (head - count + capacity) % capacity
    const physicalIndex = (this.head - this.count + this.capacity + index) % this.capacity;
    return this.buffer[physicalIndex];
  }

  /**
   * Returns a snapshot of the current state of the buffer.
   * @returns {TemporalSnapshot} Metadata and the full array of ordered frames.
   */
  getSnapshot() {
    const frames = new Array(this.count);
    let p = this.head - this.count;
    if (p < 0) {
      p += this.capacity;
    }
    for (let i = 0; i < this.count; i++) {
      frames[i] = this.buffer[p];
      p = (p + 1) % this.capacity;
    }

    return {
      capacity: this.capacity,
      currentSize: this.count,
      frames: frames,
    };
  }

  /**
   * Purges the buffer, clearing all stored frames.
   */
  purge() {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.count = 0;
  }
}
