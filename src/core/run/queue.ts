export interface QueueOptions {
  maxConcurrency: number
  maxQueue: number
}

export class Queue<J> {
  private readonly waiting: J[] = []
  private running = 0
  private draining = false
  private readonly idleResolvers: Array<() => void> = []

  constructor(
    private readonly opts: QueueOptions,
    private readonly worker: (job: J) => Promise<void>,
  ) {}

  hasCapacity(): boolean {
    return !this.draining && this.waiting.length < this.opts.maxQueue
  }

  enqueue(job: J): boolean {
    if (this.draining) return false
    if (this.waiting.length >= this.opts.maxQueue) return false
    this.waiting.push(job)
    this.pump()
    return true
  }

  private pump(): void {
    while (this.running < this.opts.maxConcurrency && this.waiting.length > 0) {
      const job = this.waiting.shift() as J
      this.running++
      void this.worker(job)
        .catch(() => {})
        .finally(() => {
          this.running--
          this.pump()
          this.checkIdle()
        })
    }
  }

  private checkIdle(): void {
    if (this.running === 0 && this.waiting.length === 0) {
      for (const resolve of this.idleResolvers.splice(0)) resolve()
    }
  }

  async drain(): Promise<void> {
    this.draining = true
    if (this.running === 0 && this.waiting.length === 0) return
    await new Promise<void>((resolve) => this.idleResolvers.push(resolve))
  }

  get stats(): { waiting: number; running: number } {
    return { waiting: this.waiting.length, running: this.running }
  }
}
