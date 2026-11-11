import {
  COMMAND_CONFIRM_INTERVAL_MS,
  COMMAND_CONFIRM_TIMEOUT_MS,
  RATE_LIMIT_WINDOW_MS,
  STATUS_REQUESTS_PER_WINDOW,
} from '../smartthings/limits.js';

export interface StatusPollerOptions<T> {
  pollIntervalMs: number;
  /**
   * Performs one status read and returns what was read, or `undefined` when nothing was read.
   * Errors are caught and logged by the poller.
   */
  read: () => Promise<T | undefined>;
  log: { debug(message: string): void; warn(message: string): void };
  confirmIntervalMs?: number;
  confirmTimeoutMs?: number;
  windowMs?: number;
  maxReadsPerWindow?: number;
}

interface Confirmation<T> {
  deadline: number;
  /** Judged with the value returned by the latest read, not with any cached state. */
  isDone: (value: T) => boolean;
  onTimeout: () => void;
}

/**
 * Schedules `GET /status` reads for one vehicle with a single timer, so regular polling and command
 * confirmation never overlap. Every read passes a sliding-window budget (10 reads per 60 s by default),
 * which also covers any fixed 60 s window the server uses.
 */
export class StatusPoller<T = unknown> {
  private readonly pollIntervalMs: number;
  private readonly confirmIntervalMs: number;
  private readonly confirmTimeoutMs: number;
  private readonly windowMs: number;
  private readonly maxReadsPerWindow: number;
  private timer?: ReturnType<typeof setTimeout>;
  private readTimes: number[] = [];
  private confirmation?: Confirmation<T>;
  private reading = false;
  private running = false;

  constructor(private readonly options: StatusPollerOptions<T>) {
    this.pollIntervalMs = options.pollIntervalMs;
    this.confirmIntervalMs = options.confirmIntervalMs ?? COMMAND_CONFIRM_INTERVAL_MS;
    this.confirmTimeoutMs = options.confirmTimeoutMs ?? COMMAND_CONFIRM_TIMEOUT_MS;
    this.windowMs = options.windowMs ?? RATE_LIMIT_WINDOW_MS;
    this.maxReadsPerWindow = options.maxReadsPerWindow ?? STATUS_REQUESTS_PER_WINDOW;
  }

  /** Starts polling with an immediate first read. */
  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.schedule(0);
  }

  stop(): void {
    this.running = false;
    this.confirmation = undefined;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Switch to command confirmation: read every `confirmIntervalMs` until `isDone(value)` holds for a freshly
   * read value, or the timeout. A newer confirmation replaces an older one.
   */
  confirm(isDone: (value: T) => boolean, onTimeout: () => void): void {
    if (!this.running) {
      return;
    }
    this.confirmation = { deadline: Date.now() + this.confirmTimeoutMs, isDone, onTimeout };
    if (!this.reading) {
      this.schedule(this.confirmIntervalMs);
    }
  }

  /** Number of reads in the current sliding window (for tests and diagnostics). */
  readsInWindow(now = Date.now()): number {
    this.pruneReads(now);
    return this.readTimes.length;
  }

  private schedule(delayMs: number): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    if (!this.running) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.tick().catch((error: unknown) => {
        this.options.log.warn(`상태 조회 예약 오류 / Status scheduling error: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, Math.max(0, delayMs));
  }

  private pruneReads(now: number): void {
    this.readTimes = this.readTimes.filter((time) => now - time < this.windowMs);
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    this.pruneReads(now);
    if (this.readTimes.length >= this.maxReadsPerWindow) {
      const waitMs = this.readTimes[0] + this.windowMs - now;
      this.options.log.debug(`상태 조회 한도 대기 / Status read budget reached; waiting ${waitMs} ms`);
      this.schedule(waitMs);
      return;
    }

    this.readTimes.push(now);
    this.reading = true;
    let value: T | undefined;
    try {
      value = await this.options.read();
    } catch (error) {
      this.options.log.warn(`상태 조회 오류 / Status read error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.reading = false;
    }

    if (!this.running) {
      return;
    }
    const confirmation = this.confirmation;
    if (!confirmation) {
      this.schedule(this.pollIntervalMs);
      return;
    }
    if (value !== undefined && confirmation.isDone(value)) {
      this.confirmation = undefined;
      this.schedule(this.pollIntervalMs);
      return;
    }
    const remaining = confirmation.deadline - Date.now();
    if (remaining <= 0) {
      this.confirmation = undefined;
      try {
        confirmation.onTimeout();
      } catch (error) {
        this.options.log.warn(`명령 확인 시간 초과 처리 오류 / Confirmation timeout handler error: ${error instanceof Error ? error.message : String(error)}`);
      }
      this.schedule(this.pollIntervalMs);
      return;
    }
    this.schedule(Math.min(this.confirmIntervalMs, remaining));
  }
}
