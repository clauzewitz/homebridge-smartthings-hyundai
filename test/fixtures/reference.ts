/**
 * Fixture values derived from gomeng-dev/smartthings-vehicle-ha (MIT), commit 5cba3c2:
 * tests/test_vehicle.py and tests/test_vehicle_discovery.py. See THIRD_PARTY_NOTICES.
 */

/** Combustion vehicle status (test_vehicle.py, test_parse_vehicle_status). */
export const ICE_STATUS = {
  components: {
    main: {
      vehicleRange: { estimatedRemainingRange: { value: 412, unit: 'km' } },
      vehicleOdometer: { odometerReading: { value: 12345.6, unit: 'km' } },
      vehicleInformation: {
        vehicleMake: { value: 'Hyundai' },
        vehicleModel: { value: 'IONIQ 5' },
      },
      vehicleEngine: { engineState: { value: 'off' } },
      vehicleHvac: {
        hvacState: { value: 'off' },
        hvacSpeed: { value: 3 },
        defogState: { value: 'off' },
        temperature: { value: 22, unit: 'C' },
      },
      vehicleDoorState: {
        lockState: { value: 'locked' },
        frontLeftDoor: { value: 'locked' },
        frontRightDoor: { value: 'locked' },
        rearLeftDoor: { value: 'locked' },
        rearRightDoor: { value: 'locked' },
      },
      vehicleWindowState: {
        frontLeftWindow: { value: 'closed' },
        frontRightWindow: { value: 'closed' },
        rearLeftWindow: { value: 'closed' },
        rearRightWindow: { value: 'closed' },
      },
      vehicleWarning: {
        fuel: { value: 'normal' },
        smartKeyBattery: { value: 'normal' },
        tirePressureFrontLeft: { value: 'normal' },
        tirePressureFrontRight: { value: 'normal' },
        tirePressureRearLeft: { value: 'warning' },
        tirePressureRearRight: { value: 'normal' },
        lampWire: { value: 'normal' },
        washerFluid: { value: 'warning' },
        brakeFluid: { value: 'normal' },
        engineOil: { value: 'normal' },
      },
      healthCheck: { 'DeviceWatch-DeviceStatus': { value: 'online' } },
    },
  },
};

/** 2025 IONIQ 5 electric vehicle status (test_vehicle.py, test_parse_2025_ioniq5_electric_vehicle_status). */
export const EV_STATUS = {
  components: {
    main: {
      vehicleRange: { estimatedRemainingRange: { value: 386, unit: 'km' } },
      vehicleBattery: {
        batteryLevel: { value: 72, unit: '%' },
        chargingState: { value: 'charging' },
        chargingPlug: { value: 'connected' },
        chargingDetail: { value: 'fastCharging' },
      },
      vehicleWarning: {
        auxiliaryBattery: { value: 'normal' },
        electricVehicleBattery: { value: 'normal' },
        tirePressureFrontLeft: { value: 'normal' },
        tirePressureFrontRight: { value: 'normal' },
        tirePressureRearLeft: { value: 'normal' },
        tirePressureRearRight: { value: 'normal' },
        lampWire: { value: 'normal' },
        washerFluid: { value: 'normal' },
        brakeFluid: { value: 'normal' },
        engineOil: { value: 'normal' },
      },
    },
  },
};

/** `GET /devices` items (test_vehicle_discovery.py). */
export const DEVICE_ITEMS = [
  {
    deviceId: 'vehicle-1',
    label: '쏘나타',
    name: 'hyundai-sonata',
    manufacturerName: 'Hyundai',
    components: [{ id: 'main', capabilities: [{ id: 'vehicleRange' }, { id: 'vehicleDoorState' }] }],
  },
  {
    deviceId: 'bulb-1',
    label: '거실등',
    components: [{ id: 'main', capabilities: [{ id: 'switch' }] }],
  },
  {
    deviceId: 'vehicle-2',
    name: 'kia-ev6',
    components: [{ id: 'main', capabilities: [{ id: 'vehicleEngine' }] }],
  },
];
