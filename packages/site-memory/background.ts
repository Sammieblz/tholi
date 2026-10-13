/** Coalesce durable work without lending its latency to navigation commands. */
export class BackgroundMemory {
  private pending = new Map<string, () => Promise<void>>();
  private running?: Promise<void>;

  schedule(key: string, operation: () => Promise<void>) {
    this.pending.set(key, operation);
    while (this.pending.size > 64)
      this.pending.delete(this.pending.keys().next().value!);
    this.running ??= Promise.resolve().then(async () => {
      try {
        while (this.pending.size) {
          const [key, operation] = this.pending.entries().next().value!;
          this.pending.delete(key);
          await operation().catch(() => {});
        }
      } finally {
        this.running = undefined;
      }
    });
  }

  /** Before deletion, discard queued writes and wait for the current writer. */
  async cancelAndDrain() {
    this.pending.clear();
    await this.running;
  }
}
