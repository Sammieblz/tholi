// One active recognition and one replaceable pending image. Never grow a capture backlog.
export class OcrQueue<T, R> {
  private current?: AbortController;
  private currentInput?: T;
  private pending?: {
    input: T;
    resolve: (v: R) => void;
    reject: (e: Error) => void;
  };
  constructor(private run: (input: T, signal: AbortSignal) => Promise<R>) {}
  submit(input: T): Promise<R> {
    return new Promise((resolve, reject) => {
      this.pending?.reject(new Error("OCR replaced by a fresher capture"));
      this.pending = { input, resolve, reject };
      this.drain();
    });
  }
  cancel(matches?: (input: T) => boolean) {
    const active = !!this.current && (!matches || matches(this.currentInput!));
    if (active) this.current?.abort();
    if (this.pending && (!matches || matches(this.pending.input))) {
      this.pending.reject(new Error("OCR canceled"));
      this.pending = undefined;
    }
    return active;
  }
  private drain() {
    if (this.current || !this.pending) return;
    const job = this.pending;
    this.pending = undefined;
    this.current = new AbortController();
    this.currentInput = job.input;
    const controller = this.current;
    void this.run(job.input, controller.signal)
      .then((v) => {
        controller.signal.throwIfAborted();
        job.resolve(v);
      })
      .catch((e) =>
        job.reject(e instanceof Error ? e : new Error("OCR failed")),
      )
      .finally(() => {
        this.current = undefined;
        this.currentInput = undefined;
        this.drain();
      });
  }
}
