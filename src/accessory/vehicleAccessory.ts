import type { API, Characteristic, CharacteristicValue, Logging, PlatformAccessory, Service, WithUUID } from 'homebridge';

import {
  CLIMATE_TEMPERATURE_MAX,
  CLIMATE_TEMPERATURE_MIN,
  type PluginOptions,
} from '../config.js';
import { SmartThingsUnauthorizedError } from '../smartthings/errors.js';
import {
  isAnyPositionOpen,
  isEngineOn,
  isPositionOpen,
  supportsAttribute,
  VehicleCommands,
  type CommandResult,
  type FourPositions,
  type VehicleCommand,
  type VehicleDevice,
  type VehicleStatus,
} from '../smartthings/vehicle.js';
import { StatusPoller } from './statusPoller.js';

/** The subset of SmartThingsClient the accessory needs; a mock in tests. */
export interface VehicleApi {
  getStatus(deviceId: string): Promise<VehicleStatus>;
  executeCommand(deviceId: string, command: VehicleCommand): Promise<CommandResult>;
}

export interface VehicleAccessoryContext {
  device: VehicleDevice;
  /** HeaterCooler target temperature in °C, kept across restarts. */
  targetTemperature?: number;
}

/** Battery level at or below this is reported as low. */
export const LOW_BATTERY_PERCENT = 20;
/** Stateless switches (refresh, ping) turn themselves off after this delay. */
export const MOMENTARY_SWITCH_RESET_MS = 1_000;
/** Wait briefly before sending climate-on so a target temperature sent together with Active=1 is used. */
export const CLIMATE_ON_DEBOUNCE_MS = 1_000;

type ServiceType = WithUUID<typeof Service>;
type CharacteristicType = WithUUID<new () => Characteristic>;

const POSITIONS: ReadonlyArray<{ key: keyof FourPositions; id: string; ko: string; en: string }> = [
  { key: 'frontLeft', id: 'front-left', ko: '앞 왼쪽', en: 'Front Left' },
  { key: 'frontRight', id: 'front-right', ko: '앞 오른쪽', en: 'Front Right' },
  { key: 'rearLeft', id: 'rear-left', ko: '뒤 왼쪽', en: 'Rear Left' },
  { key: 'rearRight', id: 'rear-right', ko: '뒤 오른쪽', en: 'Rear Right' },
];

const WARNING_LABELS: ReadonlyArray<{ key: keyof VehicleStatus['warnings']; label: string }> = [
  { key: 'fuel', label: '연료 fuel' },
  { key: 'smartKeyBattery', label: '스마트키 배터리 smart key battery' },
  { key: 'tirePressure', label: '타이어 공기압 tire pressure' },
  { key: 'lampWire', label: '외장 램프 lamp wire' },
  { key: 'washerFluid', label: '워셔액 washer fluid' },
  { key: 'brakeFluid', label: '브레이크액 brake fluid' },
  { key: 'engineOil', label: '엔진오일 engine oil' },
  { key: 'auxiliaryBattery', label: '보조 배터리 auxiliary battery' },
  { key: 'electricVehicleBattery', label: '고전압 배터리 EV battery' },
];

/** Service subtypes whose presence is decided by config. Battery and engine follow the vehicle's reported attributes. */
const CONFIG_MANAGED_SUBTYPES = new Set<string>([
  'lock', 'climate', 'climate-switch', 'cabin-temperature', 'doors', 'windows', 'warnings', 'refresh', 'ping', 'range',
  ...POSITIONS.map((position) => `door-${position.id}`),
  ...POSITIONS.map((position) => `window-${position.id}`),
]);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Serial number shown in HomeKit: the first 8 characters of the SmartThings device id only. */
export function maskDeviceId(deviceId: string): string {
  return deviceId.length > 8 ? `${deviceId.slice(0, 8)}-xxxx` : deviceId;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * One SmartThings vehicle as one HomeKit accessory.
 *
 * Characteristic getters only return cached values. Commands are sent only from HomeKit writes, never
 * from startup or polling.
 */
export class VehicleAccessory {
  private readonly hap: API['hap'];
  private readonly poller: StatusPoller;
  private readonly boundServices = new Set<string>();
  /** Value readers per bound characteristic, used for onGet and for pushing new status values. */
  private readonly readers = new Map<Characteristic, (status: VehicleStatus) => CharacteristicValue>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private status?: VehicleStatus;
  private failed = false;
  private pendingLockTarget?: number;
  private pendingClimateOn?: boolean;
  private lastWarnings = '';
  private lastDistanceLog = '';

  constructor(
    private readonly api: API,
    private readonly log: Logging,
    private readonly options: PluginOptions,
    private readonly client: VehicleApi,
    public readonly accessory: PlatformAccessory<VehicleAccessoryContext>,
  ) {
    this.hap = api.hap;
    this.poller = new StatusPoller({
      pollIntervalMs: options.pollingIntervalSeconds * 1000,
      read: () => this.readStatus(),
      log: { debug: (message) => this.log.debug(this.prefix(message)), warn: (message) => this.log.warn(this.prefix(message)) },
    });
    this.setupConfigServices();
  }

  private get device(): VehicleDevice {
    return this.accessory.context.device;
  }

  private prefix(message: string): string {
    return `[${this.device.label}] ${message}`;
  }

  start(): void {
    this.poller.start();
  }

  stop(): void {
    this.poller.stop();
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  updateDevice(device: VehicleDevice): void {
    this.accessory.context.device = device;
    this.updateInformation();
  }

  // -------------------------------------------------------------------------
  // Service setup
  // -------------------------------------------------------------------------

  private setupConfigServices(): void {
    const { Service } = this.hap;
    this.updateInformation();

    const wanted = new Set<string>(['lock', 'warnings', 'refresh', 'ping']);
    wanted.add(this.options.climateAsSwitch ? 'climate-switch' : 'climate');
    if (this.options.climateAsSwitch) {
      wanted.add('cabin-temperature');
    }
    if (this.options.individualDoorWindowSensors) {
      POSITIONS.forEach((position) => {
        wanted.add(`door-${position.id}`);
        wanted.add(`window-${position.id}`);
      });
    } else {
      wanted.add('doors');
      wanted.add('windows');
    }
    if (this.options.exposeRangeAsLightSensor) {
      wanted.add('range');
    }

    for (const service of [...this.accessory.services]) {
      if (service.subtype && CONFIG_MANAGED_SUBTYPES.has(service.subtype) && !wanted.has(service.subtype)) {
        this.accessory.removeService(service);
      }
    }

    this.setupLock();
    if (this.options.climateAsSwitch) {
      this.setupClimateSwitch();
    } else {
      this.setupHeaterCooler();
    }
    if (this.options.individualDoorWindowSensors) {
      for (const position of POSITIONS) {
        this.setupContact(`door-${position.id}`, `${position.ko} 도어 ${position.en} Door`, (status) => isPositionOpen(status.doors[position.key]));
        this.setupContact(`window-${position.id}`, `${position.ko} 창문 ${position.en} Window`, (status) => isPositionOpen(status.windows[position.key]));
      }
    } else {
      this.setupContact('doors', '도어 Doors', (status) => isAnyPositionOpen(status.doors));
      this.setupContact('windows', '창문 Windows', (status) => isAnyPositionOpen(status.windows));
    }
    this.setupContact('warnings', '차량 경고 Warnings', (status) => this.activeWarnings(status).length > 0);
    this.setupMomentarySwitch('refresh', '상태 새로고침 Refresh', () => this.sendRefresh());
    this.setupMomentarySwitch('ping', '연결 확인 Ping', () => this.sendPing());
    if (this.options.exposeRangeAsLightSensor) {
      const service = this.ensureService(Service.LightSensor, 'range', '주행 가능 거리 Range');
      this.bindGet(service, this.hap.Characteristic.CurrentAmbientLightLevel, (status) =>
        Math.min(100_000, Math.max(0.0001, status.rangeKm ?? 0)));
    }

    // Attribute-driven services restored from cache need their handlers before the first status arrives.
    if (this.accessory.getServiceById(Service.Battery, 'battery')) {
      this.setupBattery();
    }
    if (this.accessory.getServiceById(Service.OccupancySensor, 'engine')) {
      this.setupEngine();
    }
  }

  private updateInformation(): void {
    const { Characteristic, Service } = this.hap;
    const info = this.accessory.getService(Service.AccessoryInformation) ?? this.accessory.addService(Service.AccessoryInformation);
    info
      .setCharacteristic(Characteristic.Manufacturer, this.device.manufacturer ?? 'SmartThings')
      .setCharacteristic(Characteristic.Model, this.device.model ?? 'Vehicle')
      .setCharacteristic(Characteristic.SerialNumber, maskDeviceId(this.device.deviceId));
  }

  private ensureService(type: ServiceType, subtype: string, name: string): Service {
    const existing = this.accessory.getServiceById(type, subtype);
    if (existing) {
      return existing;
    }
    const service = this.accessory.addService(type, name, subtype);
    service.addOptionalCharacteristic(this.hap.Characteristic.ConfiguredName);
    service.setCharacteristic(this.hap.Characteristic.ConfiguredName, name);
    return service;
  }

  /** Bind a getter that serves the cached status, or reports "No Response" when there is none. */
  private bindGet(service: Service, characteristic: CharacteristicType, read: (status: VehicleStatus) => CharacteristicValue): Characteristic {
    const bound = service.getCharacteristic(characteristic);
    this.readers.set(bound, read);
    return bound.onGet(() => read(this.requireStatus()));
  }

  private requireStatus(): VehicleStatus {
    if (this.failed || !this.status) {
      throw new this.hap.HapStatusError(this.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    return this.status;
  }

  private notAllowed(): Error {
    return new this.hap.HapStatusError(this.hap.HAPStatus.NOT_ALLOWED_IN_CURRENT_STATE);
  }

  private setupLock(): void {
    const { Characteristic, Service } = this.hap;
    const service = this.ensureService(Service.LockMechanism, 'lock', '잠금 Lock');
    this.bindGet(service, Characteristic.LockCurrentState, (status) => this.lockCurrent(status));
    this.bindGet(service, Characteristic.LockTargetState, (status) => this.lockTarget(status))
      .onSet((value) => this.setLockTarget(value));
  }

  private setupHeaterCooler(): void {
    const { Characteristic, Service } = this.hap;
    const service = this.ensureService(Service.HeaterCooler, 'climate', '공조 Climate');
    this.bindGet(service, Characteristic.Active, (status) => this.climateOn(status) ? 1 : 0)
      .onSet((value) => this.setClimate(value === 1 || value === true));
    this.bindGet(service, Characteristic.CurrentHeaterCoolerState, (status) =>
      this.isHvacOn(status)
        ? Characteristic.CurrentHeaterCoolerState.COOLING
        : Characteristic.CurrentHeaterCoolerState.INACTIVE);
    // Set a valid value before narrowing the props so HAP does not warn about the default value.
    service.getCharacteristic(Characteristic.TargetHeaterCoolerState)
      .updateValue(Characteristic.TargetHeaterCoolerState.COOL)
      .setProps({ validValues: [Characteristic.TargetHeaterCoolerState.COOL] });
    this.bindGet(service, Characteristic.TargetHeaterCoolerState, () => Characteristic.TargetHeaterCoolerState.COOL)
      .onSet(() => undefined);
    this.bindGet(service, Characteristic.CurrentTemperature, (status) => clamp(status.cabinTemperature ?? 0, 0, 100));
    service.getCharacteristic(Characteristic.CoolingThresholdTemperature)
      .updateValue(this.targetTemperature())
      .setProps({ minValue: CLIMATE_TEMPERATURE_MIN, maxValue: CLIMATE_TEMPERATURE_MAX, minStep: 1 });
    this.bindGet(service, Characteristic.CoolingThresholdTemperature, () => this.targetTemperature())
      .onSet((value) => this.setTargetTemperature(Number(value)));
  }

  private setupClimateSwitch(): void {
    const { Characteristic, Service } = this.hap;
    const service = this.ensureService(Service.Switch, 'climate-switch', '공조 Climate');
    this.bindGet(service, Characteristic.On, (status) => this.climateOn(status))
      .onSet((value) => this.setClimate(value === true || value === 1));
    const cabin = this.ensureService(Service.TemperatureSensor, 'cabin-temperature', '실내 온도 Cabin Temperature');
    this.bindGet(cabin, Characteristic.CurrentTemperature, (status) => clamp(status.cabinTemperature ?? 0, -100, 100));
  }

  private setupBattery(): void {
    if (this.boundServices.has('battery')) {
      return;
    }
    this.boundServices.add('battery');
    const { Characteristic, Service } = this.hap;
    const service = this.ensureService(Service.Battery, 'battery', '배터리 Battery');
    this.bindGet(service, Characteristic.BatteryLevel, (status) => Math.round(clamp(status.battery.level ?? 0, 0, 100)));
    this.bindGet(service, Characteristic.ChargingState, (status) =>
      status.battery.chargingState === 'charging'
        ? Characteristic.ChargingState.CHARGING
        : Characteristic.ChargingState.NOT_CHARGING);
    this.bindGet(service, Characteristic.StatusLowBattery, (status) =>
      (status.battery.level !== undefined && status.battery.level <= LOW_BATTERY_PERCENT) || status.warnings.electricVehicleBattery === 'warning'
        ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
        : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
  }

  private setupEngine(): void {
    if (this.boundServices.has('engine')) {
      return;
    }
    this.boundServices.add('engine');
    const { Characteristic, Service } = this.hap;
    const service = this.ensureService(Service.OccupancySensor, 'engine', '시동 Engine');
    this.bindGet(service, Characteristic.OccupancyDetected, (status) =>
      isEngineOn(status)
        ? Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
        : Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
  }

  private setupContact(subtype: string, name: string, isOpen: (status: VehicleStatus) => boolean | undefined): void {
    const { Characteristic, Service } = this.hap;
    const service = this.ensureService(Service.ContactSensor, subtype, name);
    this.bindGet(service, Characteristic.ContactSensorState, (status) =>
      isOpen(status)
        ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
        : Characteristic.ContactSensorState.CONTACT_DETECTED);
  }

  private setupMomentarySwitch(subtype: string, name: string, send: () => Promise<void>): void {
    const { Characteristic, Service } = this.hap;
    const service = this.ensureService(Service.Switch, subtype, name);
    service.getCharacteristic(Characteristic.On)
      .onGet(() => false)
      .onSet((value) => {
        if (value !== true && value !== 1) {
          return;
        }
        this.later(MOMENTARY_SWITCH_RESET_MS, () => service.updateCharacteristic(Characteristic.On, false));
        send().catch((error: unknown) => this.log.error(this.prefix(`명령 오류 / Command error: ${errorMessage(error)}`)));
      });
  }

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  private async readStatus(): Promise<void> {
    try {
      const status = await this.client.getStatus(this.device.deviceId);
      if (this.failed) {
        this.log.info(this.prefix('SmartThings 연결이 복구됐습니다. / SmartThings connection restored.'));
      }
      this.failed = false;
      this.log.debug(this.prefix(`상태 갱신 / Status updated (lastUpdated ${status.lastUpdated?.toISOString() ?? '-'})`));
      this.applyStatus(status);
    } catch (error) {
      if (!this.failed) {
        const kind = error instanceof SmartThingsUnauthorizedError ? '인증 실패 / Authorization failed' : '상태 조회 실패 / Status read failed';
        this.log.error(this.prefix(`${kind}: ${errorMessage(error)} — '응답 없음'으로 표시합니다. / Reporting 'No Response'.`));
      } else {
        this.log.debug(this.prefix(`상태 조회 실패 계속 / Status read still failing: ${errorMessage(error)}`));
      }
      this.failed = true;
    }
  }

  private applyStatus(status: VehicleStatus): void {
    this.status = status;
    if (supportsAttribute(status, 'vehicleBattery', 'batteryLevel')) {
      this.setupBattery();
    }
    if (supportsAttribute(status, 'vehicleEngine', 'engineState')) {
      this.setupEngine();
    }
    if (this.pendingLockTarget !== undefined && this.lockMatches(status, this.pendingLockTarget)) {
      this.pendingLockTarget = undefined;
    }
    if (this.pendingClimateOn !== undefined && this.isHvacOn(status) === this.pendingClimateOn) {
      this.pendingClimateOn = undefined;
    }
    this.applyTemperatureRange(status);
    this.logChanges(status);
    this.pushValues(status);
  }

  /** Push cached values to HomeKit by re-running each bound reader. */
  private pushValues(status: VehicleStatus): void {
    for (const [characteristic, read] of this.readers) {
      characteristic.updateValue(read(status));
    }
  }

  private applyTemperatureRange(status: VehicleStatus): void {
    const service = this.accessory.getServiceById(this.hap.Service.HeaterCooler, 'climate');
    if (!service) {
      return;
    }
    const { minValue, maxValue } = this.temperatureBounds(status);
    const characteristic = service.getCharacteristic(this.hap.Characteristic.CoolingThresholdTemperature);
    if (characteristic.props.minValue !== minValue || characteristic.props.maxValue !== maxValue) {
      characteristic.setProps({ minValue, maxValue, minStep: 1 });
    }
  }

  private logChanges(status: VehicleStatus): void {
    const distance = `${status.rangeKm ?? '-'}|${status.odometerKm ?? '-'}`;
    if (distance !== this.lastDistanceLog) {
      this.lastDistanceLog = distance;
      this.log.info(this.prefix(
        `주행 가능 거리 ${status.rangeKm ?? '-'} km, 누적 주행거리 ${status.odometerKm ?? '-'} km / ` +
        `Range ${status.rangeKm ?? '-'} km, odometer ${status.odometerKm ?? '-'} km`,
      ));
    }
    const warnings = this.activeWarnings(status).join(', ');
    if (warnings !== this.lastWarnings) {
      this.lastWarnings = warnings;
      if (warnings) {
        this.log.warn(this.prefix(`차량 경고 / Vehicle warnings: ${warnings}`));
      } else {
        this.log.info(this.prefix('차량 경고 없음 / No vehicle warnings'));
      }
    }
  }

  private activeWarnings(status: VehicleStatus): string[] {
    const active = WARNING_LABELS.filter(({ key }) => status.warnings[key] === 'warning').map(({ label }) => label);
    if (status.warnings.tirePressure === 'warning') {
      const tires = POSITIONS.filter((position) => status.warnings.tirePressurePositions[position.key] === 'warning')
        .map((position) => position.en);
      if (tires.length > 0) {
        active[active.indexOf('타이어 공기압 tire pressure')] = `타이어 공기압 tire pressure (${tires.join(', ')})`;
      }
    }
    return active;
  }

  // -------------------------------------------------------------------------
  // Lock
  // -------------------------------------------------------------------------

  private lockCurrent(status: VehicleStatus): number {
    const { LockCurrentState } = this.hap.Characteristic;
    switch (status.lockState) {
    case 'locked':
      return LockCurrentState.SECURED;
    case 'unlocked':
      return LockCurrentState.UNSECURED;
    default:
      return LockCurrentState.UNKNOWN;
    }
  }

  private lockTarget(status: VehicleStatus): number {
    const { LockTargetState } = this.hap.Characteristic;
    if (this.pendingLockTarget !== undefined) {
      return this.pendingLockTarget;
    }
    return status.lockState === 'unlocked' ? LockTargetState.UNSECURED : LockTargetState.SECURED;
  }

  private lockMatches(status: VehicleStatus, target: number): boolean {
    return status.lockState === (target === this.hap.Characteristic.LockTargetState.SECURED ? 'locked' : 'unlocked');
  }

  private revertLockTarget(): void {
    this.pendingLockTarget = undefined;
    const service = this.accessory.getServiceById(this.hap.Service.LockMechanism, 'lock');
    if (service && this.status) {
      service.updateCharacteristic(this.hap.Characteristic.LockTargetState, this.lockTarget(this.status));
    }
  }

  private setLockTarget(value: CharacteristicValue): void {
    const { LockTargetState } = this.hap.Characteristic;
    const target = Number(value);
    if (target === LockTargetState.UNSECURED && !this.options.allowUnlock) {
      this.log.warn(this.prefix('잠금 해제가 설정에서 꺼져 있어 요청을 거부했습니다. / Unlock is disabled in the settings; request rejected.'));
      this.revertLockTarget();
      throw this.notAllowed();
    }
    this.pendingLockTarget = target;
    const unlock = target === LockTargetState.UNSECURED;
    this.runCommand(
      unlock ? '잠금 해제 unlock' : '잠금 lock',
      unlock ? VehicleCommands.unlock() : VehicleCommands.lock(),
      () => this.pendingLockTarget === undefined,
      () => this.revertLockTarget(),
    );
  }

  // -------------------------------------------------------------------------
  // Climate
  // -------------------------------------------------------------------------

  private isHvacOn(status: VehicleStatus): boolean {
    return status.hvacState === 'on';
  }

  private climateOn(status: VehicleStatus): boolean {
    return this.pendingClimateOn ?? this.isHvacOn(status);
  }

  private temperatureBounds(status: VehicleStatus | undefined): { minValue: number; maxValue: number } {
    const range = status?.temperatureRange;
    const minValue = range?.minimum !== undefined ? Math.max(CLIMATE_TEMPERATURE_MIN, Math.ceil(range.minimum)) : CLIMATE_TEMPERATURE_MIN;
    const maxValue = range?.maximum !== undefined ? Math.min(CLIMATE_TEMPERATURE_MAX, Math.floor(range.maximum)) : CLIMATE_TEMPERATURE_MAX;
    return minValue <= maxValue ? { minValue, maxValue } : { minValue: CLIMATE_TEMPERATURE_MIN, maxValue: CLIMATE_TEMPERATURE_MAX };
  }

  /** HeaterCooler: stored target (context) or the configured temperature. Switch mode: always the configured temperature. */
  private targetTemperature(): number {
    const { minValue, maxValue } = this.temperatureBounds(this.status);
    const stored = this.options.climateAsSwitch ? undefined : this.accessory.context.targetTemperature;
    return Math.round(clamp(stored ?? this.options.climateTemperature, minValue, maxValue));
  }

  private setTargetTemperature(value: number): void {
    if (!Number.isFinite(value)) {
      return;
    }
    const { minValue, maxValue } = this.temperatureBounds(this.status);
    this.accessory.context.targetTemperature = Math.round(clamp(value, minValue, maxValue));
    this.api.updatePlatformAccessories([this.accessory]);
    this.log.info(this.prefix(
      `공조 목표 온도 ${this.accessory.context.targetTemperature}℃ (다음 켜기부터 적용) / ` +
      `Climate target ${this.accessory.context.targetTemperature}°C (applies from the next start)`,
    ));
  }

  private revertClimate(): void {
    this.pendingClimateOn = undefined;
    const { Characteristic, Service } = this.hap;
    if (!this.status) {
      return;
    }
    const on = this.isHvacOn(this.status);
    const heaterCooler = this.accessory.getServiceById(Service.HeaterCooler, 'climate');
    const climateSwitch = this.accessory.getServiceById(Service.Switch, 'climate-switch');
    heaterCooler?.updateCharacteristic(Characteristic.Active, on ? 1 : 0);
    climateSwitch?.updateCharacteristic(Characteristic.On, on);
  }

  private setClimate(on: boolean): void {
    if (on && !this.options.allowClimate) {
      this.log.warn(this.prefix('원격 공조가 설정에서 꺼져 있어 요청을 거부했습니다. / Remote climate is disabled in the settings; request rejected.'));
      this.revertClimate();
      throw this.notAllowed();
    }
    if (this.status && this.isHvacOn(this.status) === on && this.pendingClimateOn === undefined) {
      return;
    }
    this.pendingClimateOn = on;
    if (!on) {
      this.runCommand('공조 끄기 climate off', VehicleCommands.climateOff(), () => this.pendingClimateOn === undefined, () => this.revertClimate());
      return;
    }
    this.later(CLIMATE_ON_DEBOUNCE_MS, () => {
      if (this.pendingClimateOn !== true) {
        return;
      }
      const settings = { temperature: this.targetTemperature(), durationMinutes: this.options.climateDuration, defog: this.options.climateDefog };
      this.runCommand(
        `공조 켜기 climate on (${settings.temperature}℃, ${settings.durationMinutes}min, defog ${settings.defog ? 'on' : 'off'})`,
        VehicleCommands.climateOn(settings),
        () => this.pendingClimateOn === undefined,
        () => this.revertClimate(),
      );
    });
  }

  // -------------------------------------------------------------------------
  // Refresh / ping
  // -------------------------------------------------------------------------

  private async sendRefresh(): Promise<void> {
    const before = this.status?.lastUpdated?.getTime() ?? 0;
    await this.client.executeCommand(this.device.deviceId, VehicleCommands.refresh());
    this.log.info(this.prefix('새로고침 요청 접수 / Refresh accepted'));
    this.poller.confirm(
      () => (this.status?.lastUpdated?.getTime() ?? 0) > before,
      () => this.log.info(this.prefix('새로고침 후 새 데이터가 아직 없습니다. / No newer data after refresh yet.')),
    );
  }

  private async sendPing(): Promise<void> {
    await this.client.executeCommand(this.device.deviceId, VehicleCommands.ping());
    this.log.info(this.prefix('연결 확인 요청 접수 / Ping accepted'));
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Send a command in the background; HomeKit writes return immediately. */
  private runCommand(label: string, command: VehicleCommand, isDone: () => boolean, revert: () => void): void {
    this.log.info(this.prefix(`명령 전송 / Sending command: ${label}`));
    this.client.executeCommand(this.device.deviceId, command)
      .then(() => {
        this.log.info(this.prefix(`명령 접수 / Command accepted: ${label}`));
        this.poller.confirm(isDone, () => {
          this.log.warn(this.prefix(`명령이 제한 시간 안에 반영되지 않았습니다 / Command not reflected in time: ${label}`));
          revert();
        });
      })
      .catch((error: unknown) => {
        if (error instanceof SmartThingsUnauthorizedError) {
          this.failed = true;
        }
        this.log.error(this.prefix(`명령 실패 / Command failed: ${label}: ${errorMessage(error)}`));
        revert();
      });
  }

  private later(delayMs: number, action: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      try {
        action();
      } catch (error) {
        this.log.error(this.prefix(`예약 작업 오류 / Scheduled task error: ${errorMessage(error)}`));
      }
    }, delayMs);
    this.timers.add(timer);
  }
}
