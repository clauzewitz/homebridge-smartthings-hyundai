import { StatusPoller } from '../accessory/statusPoller.js';
import type { VehicleStatus } from '../smartthings/vehicle.js';
import type { StatusSink, StatusSource, StatusSourceFactory } from './statusSource.js';

export interface PollingStatusSourceOptions {
  pollIntervalMs: number;
  getStatus: () => Promise<VehicleStatus>;
  sink: StatusSink;
  log: { debug(message: string): void; warn(message: string): void };
}

/**
 * REST polling: `GET /devices/{id}/status` on a StatusPoller (one timer, 10 reads per 60 s budget,
 * command confirmation every 10 s for up to 60 s).
 */
export class PollingStatusSource implements StatusSource {
  private readonly poller: StatusPoller;

  constructor(private readonly options: PollingStatusSourceOptions) {
    this.poller = new StatusPoller({
      pollIntervalMs: options.pollIntervalMs,
      read: () => this.read(),
      log: options.log,
    });
  }

  start(): void {
    this.poller.start();
  }

  stop(): void {
    this.poller.stop();
  }

  confirm(isDone: () => boolean, onTimeout: () => void): void {
    this.poller.confirm(isDone, onTimeout);
  }

  /** A failure while reading or while the sink applies the status is reported as a read failure. */
  private async read(): Promise<void> {
    try {
      this.options.sink.onStatus(await this.options.getStatus());
    } catch (error) {
      this.options.sink.onReadFailure(error);
    }
  }
}

export function createPollingStatusSource(
  client: { getStatus(deviceId: string): Promise<VehicleStatus> },
  pollIntervalMs: number,
): StatusSourceFactory {
  return (context) => new PollingStatusSource({
    pollIntervalMs,
    getStatus: () => client.getStatus(context.deviceId()),
    sink: context.sink,
    log: context.log,
  });
}
