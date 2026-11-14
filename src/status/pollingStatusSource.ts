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
  private readonly poller: StatusPoller<VehicleStatus>;

  constructor(private readonly options: PollingStatusSourceOptions) {
    this.poller = new StatusPoller<VehicleStatus>({
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

  confirm(isDone: (status: VehicleStatus) => boolean, onTimeout: () => void, onDone?: (status: VehicleStatus) => void): void {
    this.poller.confirm(isDone, onTimeout, onDone);
  }

  /**
   * A failure while reading or while the sink applies the status is reported as a read failure and yields
   * no status for confirmation. Otherwise the fresh status is returned so confirmation judges exactly it.
   */
  private async read(): Promise<VehicleStatus | undefined> {
    try {
      const status = await this.options.getStatus();
      this.options.sink.onStatus(status);
      return status;
    } catch (error) {
      this.options.sink.onReadFailure(error);
      return undefined;
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
