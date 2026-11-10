# homebridge-smartthings-hyundai

> ⚠️ 개발 중입니다. 지금은 PAT 보조 모드에서만 동작합니다(OAuth 는 구현 중). / Work in progress — currently works only in supplementary PAT mode (OAuth is in progress).

[한국어](#한국어) · [English](#english)

---

## 한국어

삼성 SmartThings(한국)에 등록된 **현대·제네시스·기아** 차량을 Homebridge 를 통해 Apple 홈(HomeKit)에서 조회하고 제어하는 플러그인입니다.

### 기능

| 기능 | HomeKit 표시 |
|---|---|
| 잠금 / 잠금 해제 | 잠금장치 |
| 원격 공조(시동 포함) | 에어컨 (옵션: 스위치) |
| 전기차 배터리 잔량·충전 상태 | 배터리 |
| 도어·창문 상태 | 접촉 센서 (기본: 도어 1개·창문 1개로 묶음, 옵션으로 개별 표시) |
| 차량 경고(타이어, 오일 등) | 접촉 센서 |
| 시동 상태 | 재실 센서(시동 중이면 감지) — 차량이 시동 상태를 보고할 때만. 전기차는 보통 보고하지 않음 |
| 상태 새로고침, 연결 확인 | 스위치(자동으로 꺼짐) |

시동 단독 제어와 충전 시작·중지는 제공하지 않습니다. 주행 가능 거리·누적 주행거리는 기본으로 로그에만 남깁니다.

명령(잠금·공조·새로고침·연결 확인)은 홈 앱에서 조작했을 때만 보냅니다. 상태는 설정한 주기로 조회하고, 명령을 보낸 뒤에는 10초 간격으로 최대 60초 동안 반영 여부를 확인합니다. SmartThings 상태 조회 한도(60초에 10회)를 넘지 않도록 조절합니다.

### 요구 사항

- Homebridge 1.8 이상 또는 2.x
- Node.js 22.12 이상, 24, 26
- SmartThings 계정에 등록된 차량
- SmartThings OAuth 앱(client id / secret) — 만드는 방법은 인증 기능 구현 후 안내합니다.

### 인증 방식

- **OAuth (기본, 권장)**: 토큰을 자동으로 갱신합니다. 현재 구현 중이며, OAuth 를 선택하면 아직 시작하지 않습니다.
- **개인 액세스 토큰 PAT (보조)**: 설정에서 인증 방식을 PAT 로 바꾸고 PAT 를 입력합니다.
  - 2024-12-30 이후 발급된 PAT 는 **24시간 후 만료**됩니다. 테스트용이거나 장기 PAT 를 가진 사용자용입니다.
  - PAT 는 자동 갱신할 수 없습니다. 만료되면 로그에 안내가 남고 차량이 홈 앱에서 '응답 없음'으로 표시됩니다. 새 PAT 를 입력하고 Homebridge 를 재시작하세요.
  - 필요한 권한: Devices 의 list, see, control.

### 설치

이 플러그인은 npm 에 배포하지 않습니다. 저장소를 받아 직접 빌드해 설치합니다.

```bash
git clone <이 저장소 URL>
cd homebridge-smartthings-hyundai
npm install
npm run build
npm link        # 또는 Homebridge 의 node_modules 에 설치
```

#### 권장: child bridge 로 실행하고 페어링할 때 방 지정

Homebridge 플러그인은 HomeKit accessory 가 놓일 방을 정할 수 없습니다. 방은 홈 앱이 관리하는 정보입니다. 차량을 처음부터 원하는 방(예: 차고)에 두려면 다음 순서를 권장합니다.

1. Homebridge UI → 플러그인 → 이 플러그인의 메뉴 → **Bridge Settings** 에서 child bridge 를 켭니다.
2. Homebridge 를 재시작합니다.
3. 홈 앱에서 child bridge 를 별도 브리지로 페어링합니다(Homebridge UI 에 표시되는 QR 코드나 설정 코드 사용).
4. 페어링 과정에서 accessory 의 방을 차량용 방(예: **차고**)으로 지정합니다.

accessory 의 UUID 는 SmartThings 디바이스 ID 로 만들어집니다. 그래서 Homebridge 를 재시작하거나 플러그인을 업데이트해도 홈 앱에서 지정한 방과 이름이 그대로 유지됩니다.

> 참고: Siri 는 '에어컨 다 켜줘' 처럼 서비스 종류 단위로 명령을 묶습니다. 차량을 다른 방에 두어도 집 전체 명령에서는 빠지지 않습니다. 이런 명령에서 차량을 빼려면 설정에서 **공조를 스위치로 등록** 을 켜세요.

### 설정 항목

| 키 | 설명 | 기본값 |
|---|---|---|
| `pollingInterval` | 상태 조회 주기(초). 최소 60. 더 짧게 적으면 60으로 올리고 로그에 알립니다 | 60 |
| `allowUnlock` | 잠금 해제 허용. 끄면 잠금 해제 요청을 거부합니다 | `true` |
| `allowClimate` | 원격 공조 허용. 끄면 공조 켜기 요청을 거부합니다 | `true` |
| `climateAsSwitch` | 공조를 에어컨 대신 스위치로 등록 | `false` |
| `climateTemperature` | 공조 온도(℃, 17–27). 스위치 모드의 고정값이자 에어컨 모드의 초기값 | 22 |
| `climateDuration` | 공조 작동 시간(분, 1–30) | 10 |
| `climateDefog` | 앞유리 김서림 제거 | `false` |
| `exposeRangeAsLightSensor` | 주행 가능 거리를 조도 센서(lux = km)로 표시 | `false` |
| `individualDoorWindowSensors` | 도어 4개·창문 4개를 각각 센서로 표시 | `false` |
| `authMethod` | 인증 방식: `oauth` 또는 `pat` | `oauth` |
| `personalAccessToken` | PAT (인증 방식이 `pat` 일 때만) | — |

### 안전 안내

- 잠금 해제와 원격 공조는 실제 차량 상태를 바꿉니다. 원격 공조를 켜면 작동 시간 동안 시동이 함께 걸릴 수 있습니다.
- 필요하면 `allowUnlock`, `allowClimate` 를 꺼서 해당 동작을 막으세요.

### 라이선스

MIT. 제3자 고지는 [THIRD_PARTY_NOTICES](./THIRD_PARTY_NOTICES) 를 보세요. 이 플러그인은 [gomeng-dev/smartthings-vehicle-ha](https://github.com/gomeng-dev/smartthings-vehicle-ha)(MIT)를 참고해 만들었습니다.

---

## English

A Homebridge plugin that lets you monitor and control **Hyundai, Genesis and Kia** vehicles registered in Samsung SmartThings (Korea) from Apple Home (HomeKit).

### Features

| Feature | HomeKit service |
|---|---|
| Lock / unlock | Lock |
| Remote climate (includes remote start) | Air conditioner (option: switch) |
| EV battery level and charging state | Battery |
| Door and window state | Contact sensor (default: one combined door sensor and one combined window sensor; per-position sensors optional) |
| Vehicle warnings (tires, oil, etc.) | Contact sensor |
| Engine state | Occupancy sensor (detected while the engine runs) — only when the vehicle reports engine state; EVs usually do not |
| Refresh status, check connection | Switch (turns itself off) |

Standalone engine start/stop and charging start/stop are not provided. Driving range and odometer are written to the log by default.

Commands (lock, climate, refresh, ping) are sent only when you operate the accessory in the Home app. Status is polled at the configured interval; after a command it is checked every 10 s for up to 60 s. Reads are paced to stay within the SmartThings status limit (10 per 60 s).

### Requirements

- Homebridge 1.8 or later, or 2.x
- Node.js 22.12 or later, 24, or 26
- A vehicle registered in your SmartThings account
- A SmartThings OAuth app (client id / secret) — setup instructions will be added once authorization is implemented.

### Authorization

- **OAuth (default, recommended)**: tokens are refreshed automatically. Work in progress; with OAuth selected the plugin does not start yet.
- **Personal access token, PAT (supplementary)**: set the authorization method to PAT in the settings and enter your PAT.
  - PATs issued after 2024-12-30 **expire after 24 hours**. This mode is for testing or for users who have a long-lived PAT.
  - A PAT cannot be refreshed. When it expires, the log explains what happened and the vehicle shows as 'No Response' in the Home app. Enter a new PAT and restart Homebridge.
  - Required scopes: Devices list, see and control.

### Installation

This plugin is not published to npm. Clone the repository and build it yourself.

```bash
git clone <this repository URL>
cd homebridge-smartthings-hyundai
npm install
npm run build
npm link        # or install it into Homebridge's node_modules
```

#### Recommended: run as a child bridge and choose the room while pairing

Homebridge plugins cannot set the room of a HomeKit accessory; rooms belong to the Home app. To put the vehicle in a dedicated room (for example, **Garage**) from the start:

1. In the Homebridge UI, go to Plugins → this plugin's menu → **Bridge Settings** and enable the child bridge.
2. Restart Homebridge.
3. In the Home app, pair the child bridge as a separate bridge (use the QR code or setup code shown in the Homebridge UI).
4. While pairing, assign the accessory to your vehicle room (for example, **Garage**).

Accessory UUIDs are derived from the SmartThings device ID, so the room and name you choose in the Home app are kept across Homebridge restarts and plugin updates.

> Note: Siri groups commands by service type, such as "turn on all air conditioners". Putting the vehicle in a separate room does not exclude it from home-wide commands. To exclude it, enable **Expose climate as a switch** in the settings.

### Options

| Key | Description | Default |
|---|---|---|
| `pollingInterval` | Status polling interval in seconds (minimum 60). Shorter values are raised to 60 with a log notice | 60 |
| `allowUnlock` | Allow unlock. When off, unlock requests are rejected | `true` |
| `allowClimate` | Allow remote climate. When off, requests to turn on climate are rejected | `true` |
| `climateAsSwitch` | Expose climate as a switch instead of an air conditioner | `false` |
| `climateTemperature` | Climate temperature (°C, 17–27). Fixed value in switch mode, initial value in air-conditioner mode | 22 |
| `climateDuration` | Climate duration (minutes, 1–30) | 10 |
| `climateDefog` | Windshield defog | `false` |
| `exposeRangeAsLightSensor` | Show driving range as a light sensor (lux = km) | `false` |
| `individualDoorWindowSensors` | One sensor per door and per window | `false` |
| `authMethod` | Authorization method: `oauth` or `pat` | `oauth` |
| `personalAccessToken` | PAT (only when the method is `pat`) | — |

### Safety

- Unlock and remote climate change the real vehicle state. Turning on remote climate may start the engine for the configured duration.
- Turn off `allowUnlock` or `allowClimate` if you want to block those actions.

### License

MIT. See [THIRD_PARTY_NOTICES](./THIRD_PARTY_NOTICES) for third-party notices. This plugin is based on [gomeng-dev/smartthings-vehicle-ha](https://github.com/gomeng-dev/smartthings-vehicle-ha) (MIT).
