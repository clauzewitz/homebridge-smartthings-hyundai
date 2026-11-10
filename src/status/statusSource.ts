import type { VehicleStatus } from '../smartthings/vehicle.js';

/** Receives vehicle status from a StatusSource. */
export interface StatusSink {
  /** A full, current status snapshot. */
  onStatus(status: VehicleStatus): void;
  /** Reading the status failed (network, authorization, ...). The accessory reports 'No Response'. */
  onReadFailure(error: unknown): void;
}

/**
 * Supplies vehicle status to an accessory. The accessory does not know how status is obtained
 * (REST polling now; Server-Sent Events may be added as another source later).
 */
export interface StatusSource {
  start(): void;
  stop(): void;
  /** Called after a command is ACCEPTED: keep checking until `isDone()` or give up and call `onTimeout()`. */
  confirm(isDone: () => boolean, onTimeout: () => void): void;
}

export interface StatusSourceContext {
  /** Current SmartThings device id of the vehicle. */
  deviceId(): string;
  sink: StatusSink;
  log: { debug(message: string): void; warn(message: string): void };
}

export type StatusSourceFactory = (context: StatusSourceContext) => StatusSource;
