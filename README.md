# homebridge-smartthings-hyundai

> ⚠️ 개발 중입니다. OAuth 연결은 구현했지만 아직 실제 SmartThings API 로 검증하지 않았습니다. 실제 차량 명령(잠금, 공조)도 아직 시험하지 않았습니다. / Work in progress — OAuth is implemented but not yet verified against the live SmartThings API, and real-vehicle commands (lock, climate) have not been tested yet.

[한국어](#한국어) · [English](#english)

---

## 한국어

삼성 SmartThings(한국)에 등록된 **현대·제네시스·기아** 차량을 Homebridge 를 통해 Apple 홈(HomeKit)에서 조회하고 제어하는 플러그인입니다.

- [현재 상태](#현재-상태)
- [기능과 HomeKit 표시](#기능과-homekit-표시)
- [요구 사항](#요구-사항)
- [설치](#설치)
- [SmartThings 연결(설정 화면)](#smartthings-연결설정-화면)
- [토큰과 client 정보](#토큰과-client-정보)
- [PAT 보조 모드](#pat-보조-모드)
- [홈 앱에서 쓰기](#홈-앱에서-쓰기)
- [설정 항목](#설정-항목)
- [보안 안내](#보안-안내)
- [안전 안내](#안전-안내)
- [변경 내역](#변경-내역)
- [라이선스](#라이선스)

### 현재 상태

| 항목 | 상태 |
|---|---|
| OAuth 연결(기본) | 구현함. **실제 SmartThings API 로는 아직 검증하지 않음** — 앱 만들기, 로그인, 토큰 발급·갱신 모두 해당 |
| 차량 상태 조회 | PAT 보조 모드로 차량 1대에서 확인(Homebridge Docker 설치본 포함) |
| 차량 명령 | 새로고침: 차량 1대에서 확인(요청 접수부터 새 데이터 도착까지). 잠금·잠금 해제·공조·연결 확인: **실차 시험 전** |
| 홈 앱 페어링 | 차량 1대로 확인(Homebridge Docker 설치본) |
| 다른 차종(현대·기아, 내연기관) | 확인하지 않음 |
| PAT 보조 모드 | 동작함. 다만 PAT 가 24시간 뒤 만료되어 장기 사용에는 맞지 않음 |

### 기능과 HomeKit 표시

| 기능 | HomeKit 표시 |
|---|---|
| 잠금 / 잠금 해제 | 잠금장치 |
| 원격 공조(시동 포함) | 에어컨(냉방, 목표 온도 17–27℃). 옵션: 스위치 + 실내 온도 센서 |
| 전기차 배터리 잔량·충전 상태 | 배터리 |
| 도어·창문 상태 | 접촉 센서(기본: 도어 1개·창문 1개로 묶음, 옵션으로 개별 표시) |
| 차량 경고(타이어, 오일 등) | 접촉 센서 |
| 시동 상태 | 재실 센서(시동 중이면 감지). 차량이 시동 상태를 보고할 때만 만들며, 전기차는 보통 보고하지 않음 |
| 상태 새로고침, 연결 확인 | 스위치(1초 뒤 자동으로 꺼짐) |
| 주행 가능 거리(옵션) | 조도 센서(lux = km) |

- 시동 단독 제어와 충전 시작·중지는 제공하지 않습니다. 주행 가능 거리·누적 주행거리는 기본으로 로그에만 남깁니다.
- 명령(잠금·공조·새로고침·연결 확인)은 홈 앱에서 조작했을 때만 보냅니다.
- 상태는 설정한 주기로 조회합니다. 명령을 보낸 뒤에는 10초 간격으로 최대 60초 동안 반영 여부를 확인하고, 반영되지 않으면 홈 앱 표시를 원래대로 되돌립니다.
- 새로고침 로그: '새로고침 요청 접수 / Refresh accepted' 는 SmartThings 가 요청을 받았다는 뜻, '새로고침 완료 — 데이터 시각 2026-11-14 15:50:00 (+09:00) / Refresh complete — data as of …' 는 새 데이터가 도착했다는 뜻(시각은 Homebridge 가 도는 곳의 현지 시각과 UTC 와의 차이), '새로고침 후 새 데이터가 아직 없습니다 / No newer data after refresh yet' 는 60초 안에 새 데이터가 오지 않았다는 뜻입니다.
  - Docker 컨테이너에 시간대가 설정되어 있지 않으면 로그 시각이 UTC(`+00:00`)로 보일 수 있습니다. 컨테이너에 환경 변수 `TZ=Asia/Seoul` 처럼 시간대를 지정하세요.
- SmartThings 상태 조회 한도(60초에 10회)를 넘지 않도록 조절합니다.
- 조회나 인증에 실패하면 홈 앱에서 '응답 없음'으로 표시됩니다. 플러그인이 멈추지는 않습니다.

### 요구 사항

- Homebridge 1.8 이상의 1.x 또는 2.x
- Node.js 22(22.12 이상), 24, 26
- Homebridge UI(homebridge-config-ui-x) — OAuth 연결은 플러그인 설정 화면에서 합니다.
- SmartThings 계정에 등록된 차량
- **SmartThings 유료 API 플랜(Developer Plan)** — SmartThings 는 2026-11-04 부터 OAuth 앱을 만들거나 수정할 때 유료 플랜을 요구합니다. 가격, 지원 국가, 호출 한도는 SmartThings Developer Center 에서 확인하세요.

### 설치

이 플러그인은 npm 에 배포하지 않았습니다. 저장소에서 패키지 파일(.tgz)을 만들어 Homebridge 서버에 설치합니다. 아래 명령은 Homebridge 의 일반적인 설치 형태를 기준으로 했으며 **환경에 따라 경로와 이름이 다를 수 있습니다.**

#### 1. 패키지 파일 만들기

Node.js 가 설치된 PC 에서:

```bash
git clone https://github.com/clauzewitz/homebridge-smartthings-hyundai.git
cd homebridge-smartthings-hyundai
npm install
npm run build
npm pack        # homebridge-smartthings-hyundai-<버전>.tgz 생성
```

만든 .tgz 를 Homebridge 서버로 복사합니다(예: `scp`). 업데이트할 때도 새 .tgz 로 같은 절차를 반복합니다. 설치한 뒤에는 Homebridge 를 재시작합니다(Homebridge UI 의 재시작 버튼).

#### 2-a. Raspberry Pi / Debian·Ubuntu (Homebridge 이미지 또는 apt 패키지)

이 형태는 플러그인을 Homebridge 저장 폴더(보통 `/var/lib/homebridge`)에 설치합니다. `hb-shell` 은 Homebridge 사용자와 환경으로 셸을 엽니다.

```bash
sudo hb-shell
cd /var/lib/homebridge
npm install --save /tmp/homebridge-smartthings-hyundai-<버전>.tgz
exit
```

#### 2-b. Docker (homebridge/homebridge 이미지)

컨테이너 안의 Homebridge 저장 폴더는 `/homebridge` 이고 플러그인도 그 아래에 설치합니다. .tgz 를 `/homebridge` 에 연결된 호스트 폴더(예: `./volumes/homebridge`)에 복사한 뒤:

```bash
docker exec -it homebridge npm --prefix /homebridge install /homebridge/homebridge-smartthings-hyundai-<버전>.tgz
docker restart homebridge
```

컨테이너 이름(`homebridge`)과 연결 폴더는 설치 방식에 따라 다릅니다.

#### 2-c. macOS (hb-service)

`hb-service` 로 설치한 macOS 에서는 플러그인을 npm 전역 경로에 설치합니다. 저장 폴더는 보통 `~/.homebridge` 입니다.

```bash
npm install -g ./homebridge-smartthings-hyundai-<버전>.tgz
sudo hb-service restart
```

npm 전역 경로의 권한에 따라 `sudo` 가 필요할 수 있습니다.

#### 2-d. Homebridge UI 의 터미널

Homebridge UI 의 터미널은 Docker 와 Raspberry Pi 이미지·apt 패키지에서 기본으로 켜져 있고, 그 밖의 환경에서는 `HOMEBRIDGE_CONFIG_UI_TERMINAL=1` 환경 변수로 켭니다. 터미널은 Homebridge 가 도는 환경 안에서 열리므로 위의 해당 환경 명령(2-a 의 `npm install`, 2-b 의 `npm --prefix /homebridge install`)을 그대로 씁니다. .tgz 는 먼저 서버(또는 연결 폴더)에 복사해 둡니다.

#### 개발용 실행

```bash
npm install
npm run watch
```

- `npm run watch` 는 빌드 → `npm link` → `./.homebridge-dev` 를 저장 폴더로 Homebridge 를 디버그 모드로 실행하고, `src` 가 바뀌면 다시 빌드·재시작합니다.
- 먼저 `./.homebridge-dev/config.json` 에 bridge 항목과 이 플러그인의 platform 항목(`"platform": "SmartThingsHyundai"`)을 넣습니다. `.homebridge-dev/` 는 git 에서 제외됩니다.
- 이 방식은 Homebridge UI 없이 실행하므로 OAuth 설정 화면을 쓸 수 없습니다. 개발 중에는 PAT 보조 모드를 쓰는 편이 간단합니다.

### SmartThings 연결(설정 화면)

Homebridge UI → 플러그인 → 이 플러그인의 **설정** 을 열면 위쪽에 **'SmartThings 연결'** 카드가 있고, 그 아래에 일반 설정 항목이 있습니다. 카드 맨 위에 현재 상태(앱, redirect, 연결 여부, 토큰 만료 시각)가 표시됩니다.

#### 1. 앱 준비

**앱 만들기(권장)**

1. https://account.smartthings.com/tokens 에서 임시 개인 액세스 토큰(PAT)을 만듭니다. 권한은 앱의 `r:smartapps`·`w:smartapps` 만 고르면 됩니다.
2. '임시 PAT' 칸에 넣고 **'앱 만들기'** 를 누릅니다.
   - 플러그인이 SmartThings 에 OAuth 앱을 만듭니다. 권한(scope)은 `r:devices:*`, `x:devices:*`, `sse`, redirect URI 는 `https://localhost/callback` 입니다.
   - PAT 는 이 요청에만 쓰고 저장하지 않습니다. 끝나면 토큰 페이지에서 PAT 를 지워도 됩니다(24시간 뒤에는 저절로 만료).
3. 이미 이 Homebridge 에 저장된 앱이 있으면 새로 만들지 않습니다. 이 계정에 이 플러그인이 예전에 만든 앱이 있는데 이 Homebridge 에 기록이 없으면, 확인을 받은 뒤에만 하나 더 만듭니다.

**직접 입력(이미 만든 앱)**

SmartThings CLI 나 Developer Center 에서 직접 만든 앱을 쓸 때는 **'직접 입력(이미 만든 앱)'** 을 펼쳐 client id, client secret, app id(선택), redirect URI(비우면 `https://localhost/callback`)를 넣고 **'저장'** 을 누릅니다.

- 앱에는 `r:devices:*`, `x:devices:*`, `sse` 권한과 입력한 redirect URI 가 등록되어 있어야 합니다. 플러그인은 로그인 링크에서 이 권한을 요청합니다.
- app id 를 넣어야 아래의 redirect URI 바꾸기를 쓸 수 있습니다.

새 앱을 저장하면(만들기·직접 입력 모두) 기존 토큰은 지워지므로 다시 로그인합니다.

#### 2. 로그인

1. **'로그인 링크 열기'** 를 누르면 새 창에서 SmartThings 로그인·승인 화면이 열립니다(팝업 차단을 확인하세요). 승인합니다.
2. 승인 뒤 브라우저가 `https://localhost/callback?code=…&state=…` 로 이동하며 '연결할 수 없음' 화면을 보여도 정상입니다. **주소창의 URL 전체**를 복사합니다.
3. 붙여넣기 칸에 넣고 **'연결 완료'** 를 누릅니다.
   - URL 전체 대신 `code` 값만 붙여 넣어도 됩니다. 이때는 이 설정 화면에서 방금 시작한 로그인(10분 이내)일 때만 받습니다.
   - 로그인 링크는 10분 동안 유효하고, 설정 화면을 닫으면 처음부터 다시 해야 합니다.
4. 설정의 인증 방식이 **OAuth** 인지 확인하고 Homebridge(또는 child bridge)를 재시작합니다.

**'연결 해제'** 는 저장된 토큰만 지웁니다(앱 정보는 남음).

#### redirect URI 바꾸기

`https://localhost/callback` 이 SmartThings 에서 받아들여지지 않으면 **'redirect URI 바꾸기(PAT 필요)'** 에서 다른 후보(`http://localhost:8999/callback`, `http://127.0.0.1:8999/callback`)를 고르고, 1단계의 임시 PAT 칸에 PAT 를 넣은 뒤 **'변경'** 을 누릅니다. 바꾼 뒤에는 다시 로그인합니다. 어느 후보가 받아들여지는지는 아직 확인하지 않았습니다.

#### 403 이 나올 때

'앱 만들기' 가 403 으로 거부되면 SmartThings 가 이유를 알려 주지 않아 플러그인은 원인을 구분할 수 없습니다. 다음을 확인하세요.

- 계정의 Developer Plan 구독이 활성 상태인지
- PAT 에 `w:smartapps` 권한이 있는지
- PAT 를 발급한 SmartThings 계정이 구독한 계정과 같은지
- 구독 전에 발급한 PAT 라면 새 PAT 로 다시 시도

### 토큰과 client 정보

- 저장 위치: Homebridge 저장 폴더 아래 `smartthings-hyundai/`
  - `oauth-app.json` — client id, client secret, app id, redirect URI
  - `oauth-tokens.json` — access token, refresh token, 만료 시각
  - 폴더 권한 0700, 파일 권한 0600. 저장할 때는 임시 파일에 쓴 뒤 이름을 바꿔(원자적 저장) 중간에 끊겨도 파일이 깨지지 않게 합니다.
  - 저장 폴더는 보통 `/var/lib/homebridge`(Raspberry Pi 이미지·apt), `/homebridge`(Docker), `~/.homebridge`(macOS hb-service) 입니다.
- 갱신: 만료 10분 전에 자동으로 갱신하고, 새로 받은 refresh token 을 바로 저장합니다. 여러 요청이 동시에 갱신하지 않도록 한 번으로 묶습니다. 요청이 401 이면 갱신한 뒤 한 번만 다시 시도합니다.
- 다시 로그인이 필요할 때(갱신이 거부된 경우):
  - 로그에 'SmartThings 로그인이 필요합니다. 플러그인 설정 화면에서 다시 연결하세요.' 가 남고, 설정 화면 상태에 '⚠️ 다시 로그인 필요' 가 표시되며, 홈 앱에서 차량이 '응답 없음' 이 됩니다.
  - 설정 화면에서 2. 로그인을 다시 하면, 플러그인이 새 토큰 파일을 읽어 다음 조회부터 이어서 동작합니다. 재시작은 필요 없습니다.
- 처음 시작할 때 앱이나 토큰이 없으면 로그에 안내를 남기고 시작하지 않습니다. 연결한 뒤 재시작하세요.

### PAT 보조 모드

설정에서 인증 방식을 **PAT** 로 바꾸고 PAT 를 입력합니다. 권한은 Devices 의 list, see, control 이 필요합니다.

- 2024-12-30 이후 발급된 PAT 는 **24시간 뒤 만료**되고 자동으로 갱신할 수 없습니다. 테스트용이거나 장기 PAT 를 가진 경우에만 쓰세요.
- 만료되면 로그에 안내가 남고 차량이 '응답 없음' 이 됩니다. 새 PAT 를 넣고 재시작합니다.
- PAT 는 `config.json` 에 그대로 저장됩니다([보안 안내](#보안-안내)).

### 홈 앱에서 쓰기

#### child bridge 로 실행하고 페어링할 때 방 지정(권장)

플러그인은 accessory 의 방을 정할 수 없습니다. 방은 홈 앱이 관리합니다. 차량을 처음부터 원하는 방(예: 차고)에 두려면:

1. Homebridge UI → 플러그인 → 이 플러그인의 메뉴 → **Bridge Settings** 에서 child bridge 를 켭니다.
2. Homebridge 를 재시작합니다.
3. 홈 앱에서 child bridge 를 별도 브리지로 페어링합니다(Homebridge UI 에 표시되는 QR 코드나 설정 코드).
4. 페어링하면서 accessory 의 방을 차량용 방(예: **차고**)으로 지정합니다.

accessory 의 UUID 는 SmartThings 디바이스 ID 로 만들어지므로 재시작이나 업데이트 뒤에도 홈 앱에서 정한 방과 이름이 유지됩니다.

#### 서비스 이름 언어

홈 앱에 보이는 서비스 이름(잠금, 공조, 도어 등)은 `serviceNameLanguage` 로 한국어(`ko`, 기본) 또는 영어(`en`)를 고릅니다. 로그와 설정 화면은 항상 한국어·영어로 표시합니다.

- **페어링 전에 정하세요.** 홈 앱은 페어링할 때의 이름을 계속 쓸 수 있습니다.
- 추가한 뒤 언어를 바꾸면 플러그인은 기본 이름만 바꾸고, 홈 앱에서 직접 바꾼 이름은 건드리지 않습니다.

#### 서비스 이름 앞의 차량 이름

어느 차량의 타일인지 알 수 있도록, 서비스 이름 앞에 SmartThings 의 차량 이름을 붙입니다(예: `{차량 이름} 도어`). Siri 에게도 '{차량 이름} 도어 열려 있어?' 처럼 물을 수 있습니다. `prefixServiceNames` 를 끄면 예전처럼 '도어' 만 씁니다.

- 차량 이름은 SmartThings 앱의 이름을 씁니다. 홈 앱에서 쓸 수 없는 문자(이모지, 대괄호 등)는 빼고, 이름 전체가 64자를 넘으면 차량 이름 쪽을 줄입니다. SmartThings 에서 차량 이름을 바꾸면 기본 이름도 따라 바뀝니다.
- 홈 앱에서 직접 바꾼 이름은 건드리지 않습니다.
- 실제 기기에서 차량 이름이 붙어 보이는 것을 확인했습니다. 아직 확인하지 않은 것: 이미 페어링한 accessory 에 바로 반영되는지, 홈 앱에서 바꾼 이름이 유지되는지, 이 옵션을 끄면 원래 이름으로 돌아오는지, Siri 명령, SmartThings 에서 차량 이름을 바꿨을 때 따라오는지.
- 홈 앱은 방 이름과 같은 앞 단어를 숨길 수 있습니다. 이미 페어링한 accessory 에 바뀐 이름이 바로 보이지 않으면 홈 앱에서 이름을 바꾸거나 기기를 다시 추가하세요.

#### Siri 집 전체 명령 주의

Siri 는 '에어컨 다 켜줘' 처럼 서비스 종류 단위로 명령을 묶습니다. 차량을 다른 방에 두어도 집 전체 명령에서는 빠지지 않아, 집 에어컨을 켜다가 차량 원격 공조(시동 포함)가 함께 켜질 수 있습니다. 이를 막으려면 **'공조를 스위치로 등록'**(`climateAsSwitch`)을 켜세요.

### 설정 항목

| 키 | 설명 | 기본값 |
|---|---|---|
| `name` | 플랫폼 이름 | `SmartThings Hyundai` |
| `authMethod` | 인증 방식: `oauth` 또는 `pat` | `oauth` |
| `personalAccessToken` | PAT. 인증 방식이 `pat` 일 때만 표시 | — |
| `pollingInterval` | 상태 조회 주기(초). 최소 60. 더 짧게 적으면 60으로 올리고 로그에 알립니다 | 60 |
| `allowUnlock` | 잠금 해제 허용. 끄면 잠금 해제 요청을 거부합니다 | `true` |
| `allowClimate` | 원격 공조 허용. 끄면 공조 켜기 요청을 거부합니다 | `true` |
| `climateAsSwitch` | 공조를 에어컨 대신 스위치로 등록 | `false` |
| `climateTemperature` | 공조 온도(℃, 17–27). 스위치 모드의 고정값이자 에어컨 모드의 초기값 | 22 |
| `climateDuration` | 공조 작동 시간(분, 1–30) | 10 |
| `climateDefog` | 앞유리 김서림 제거 | `false` |
| `exposeRangeAsLightSensor` | 주행 가능 거리를 조도 센서(lux = km)로 표시 | `false` |
| `individualDoorWindowSensors` | 도어 4개·창문 4개를 각각 센서로 표시 | `false` |
| `serviceNameLanguage` | 홈 앱 서비스 이름 언어: `ko` 또는 `en`. 지원하지 않는 값은 `ko` 로 쓰고 로그에 알립니다 | `ko` |
| `prefixServiceNames` | 서비스 이름 앞에 차량 이름 붙이기(예: `{차량 이름} 도어`) | `true` |

OAuth 의 client id·secret 과 토큰은 설정 항목이 아니라 설정 화면에서 관리합니다([토큰과 client 정보](#토큰과-client-정보)).

### 보안 안내

- **PAT 와 client secret 을 `config.json` 에 두지 않는 이유**: `config.json` 은 평문이고 설정 화면의 JSON 편집기에 그대로 보이며, 문제를 물을 때 붙여 넣거나 다른 곳으로 옮기기 쉽습니다. 그래서 OAuth 의 client secret·토큰은 권한 0600 파일에 따로 둡니다. Homebridge 백업에는 이 파일도 들어갈 수 있으니 백업 파일을 안전하게 보관하세요.
- **최소 권한 PAT**: 앱 만들기에 쓰는 PAT 는 `r:smartapps`·`w:smartapps` 만 고르고, 쓴 뒤 토큰 페이지에서 지우세요. PAT 보조 모드의 PAT 는 Devices 의 list, see, control 만 고르세요.
- PAT 보조 모드를 쓰면 PAT 가 `config.json` 에 저장됩니다. 장기 사용에는 OAuth 를 쓰세요.
- 플러그인은 PAT, client secret, 토큰을 로그와 설정 화면 메시지에 넣지 않도록 만들었습니다.

### 안전 안내

- 잠금 해제와 원격 공조는 실제 차량 상태를 바꿉니다. 원격 공조를 켜면 작동 시간 동안 시동이 함께 걸릴 수 있습니다.
- 필요하면 `allowUnlock`, `allowClimate` 를 꺼서 해당 동작을 막으세요.

### 변경 내역

- **0.1.3**: 로그의 시각을 Homebridge 가 도는 곳의 현지 시각(UTC 와의 차이 포함)으로 표시합니다.
- **0.1.2**: 새로고침 뒤 새 데이터가 도착하면 '새로고침 완료 — 데이터 시각 …' 로그를 남깁니다.
- **0.1.1**: 서비스 이름 앞에 차량 이름(`prefixServiceNames`, 기본 켜짐). 설치 직후에도 설정 화면에 일반 설정 폼이 보이도록 수정하고, 연결 상태를 10초 안에 받지 못하면 안내.
- **0.1.0**: 첫 패키지.

### 라이선스

MIT. 제3자 고지는 [THIRD_PARTY_NOTICES](./THIRD_PARTY_NOTICES) 를 보세요. 이 플러그인은 [gomeng-dev/smartthings-vehicle-ha](https://github.com/gomeng-dev/smartthings-vehicle-ha)(MIT)를 참고해 만들었습니다.

---

## English

A Homebridge plugin that lets you monitor and control **Hyundai, Genesis and Kia** vehicles registered in Samsung SmartThings (Korea) from Apple Home (HomeKit).

- [Current status](#current-status)
- [Features and HomeKit services](#features-and-homekit-services)
- [Requirements](#requirements)
- [Installation](#installation)
- [Connecting SmartThings (settings screen)](#connecting-smartthings-settings-screen)
- [Tokens and client credentials](#tokens-and-client-credentials)
- [Supplementary PAT mode](#supplementary-pat-mode)
- [Using it in the Home app](#using-it-in-the-home-app)
- [Options](#options)
- [Security](#security)
- [Safety](#safety)
- [Changes](#changes)
- [License](#license)

### Current status

| Item | Status |
|---|---|
| OAuth connection (default) | Implemented. **Not yet verified against the live SmartThings API** — this covers app creation, login, and token issue and refresh |
| Reading vehicle status | Confirmed with one vehicle in supplementary PAT mode (including a Homebridge Docker install) |
| Vehicle commands | Refresh: confirmed with one vehicle (from the accepted request to newer data arriving). Lock, unlock, climate and ping: **not yet tested on a real vehicle** |
| Home app pairing | Confirmed with one vehicle (Homebridge Docker install) |
| Other models (Hyundai, Kia, combustion engines) | Not checked |
| Supplementary PAT mode | Works, but PATs expire after 24 hours, so it is not suitable for long-term use |

### Features and HomeKit services

| Feature | HomeKit service |
|---|---|
| Lock / unlock | Lock |
| Remote climate (includes remote start) | Air conditioner (cooling, target 17–27 °C). Option: switch + cabin temperature sensor |
| EV battery level and charging state | Battery |
| Door and window state | Contact sensor (default: one combined door sensor and one combined window sensor; per-position sensors optional) |
| Vehicle warnings (tires, oil, etc.) | Contact sensor |
| Engine state | Occupancy sensor (detected while the engine runs). Created only when the vehicle reports engine state; EVs usually do not |
| Refresh status, check connection | Switch (turns itself off after 1 s) |
| Driving range (optional) | Light sensor (lux = km) |

- Standalone engine start/stop and charging start/stop are not provided. Driving range and odometer are written to the log by default.
- Commands (lock, climate, refresh, ping) are sent only when you operate the accessory in the Home app.
- Status is polled at the configured interval. After a command it is checked every 10 s for up to 60 s; if the change does not show up, the Home app state is reverted.
- Refresh log: 'Refresh accepted' means SmartThings received the request, 'Refresh complete — data as of 2026-11-14 15:50:00 (+09:00)' means newer data arrived (local time of the Homebridge host with its UTC offset), and 'No newer data after refresh yet' means no newer data arrived within 60 seconds.
  - If the Docker container has no time zone set, log times may show in UTC (`+00:00`). Set one with an environment variable such as `TZ=Asia/Seoul` on the container.
- Reads are paced to stay within the SmartThings status limit (10 per 60 s).
- When a read or authorization fails, the vehicle shows 'No Response' in the Home app. The plugin does not crash.

### Requirements

- Homebridge 1.x (1.8 or later) or 2.x
- Node.js 22 (22.12 or later), 24 or 26
- Homebridge UI (homebridge-config-ui-x) — the OAuth connection is set up in the plugin settings screen.
- A vehicle registered in your SmartThings account
- **A paid SmartThings API plan (Developer Plan)** — since 2026-11-04 SmartThings requires a paid plan to create or modify OAuth apps. Check pricing, supported countries and call limits in the SmartThings Developer Center.

### Installation

This plugin is not published to npm. Build a package file (.tgz) from the repository and install it on your Homebridge server. The commands below follow common Homebridge setups; **paths and names may differ in your environment.**

#### 1. Build the package file

On a computer with Node.js:

```bash
git clone https://github.com/clauzewitz/homebridge-smartthings-hyundai.git
cd homebridge-smartthings-hyundai
npm install
npm run build
npm pack        # creates homebridge-smartthings-hyundai-<version>.tgz
```

Copy the .tgz to the Homebridge server (for example with `scp`). To update, repeat with the new .tgz. After installing, restart Homebridge (the restart button in the Homebridge UI).

#### 2-a. Raspberry Pi / Debian / Ubuntu (Homebridge image or apt package)

These setups install plugins into the Homebridge storage folder (usually `/var/lib/homebridge`). `hb-shell` opens a shell as the Homebridge user with its environment.

```bash
sudo hb-shell
cd /var/lib/homebridge
npm install --save /tmp/homebridge-smartthings-hyundai-<version>.tgz
exit
```

#### 2-b. Docker (homebridge/homebridge image)

Inside the container the Homebridge storage folder is `/homebridge`, and plugins are installed under it. Copy the .tgz into the host folder mounted at `/homebridge` (for example `./volumes/homebridge`), then:

```bash
docker exec -it homebridge npm --prefix /homebridge install /homebridge/homebridge-smartthings-hyundai-<version>.tgz
docker restart homebridge
```

The container name (`homebridge`) and the mounted folder depend on how you set it up.

#### 2-c. macOS (hb-service)

On macOS installed with `hb-service`, plugins are installed in the global npm path. The storage folder is usually `~/.homebridge`.

```bash
npm install -g ./homebridge-smartthings-hyundai-<version>.tgz
sudo hb-service restart
```

Depending on the permissions of the global npm path, `sudo` may be needed.

#### 2-d. Homebridge UI terminal

The Homebridge UI terminal is on by default in Docker and in the Raspberry Pi image / apt package; elsewhere it is enabled with the `HOMEBRIDGE_CONFIG_UI_TERMINAL=1` environment variable. The terminal opens inside the environment Homebridge runs in, so use the command for your environment above (`npm install` from 2-a, or `npm --prefix /homebridge install` from 2-b). Copy the .tgz to the server (or the mounted folder) first.

#### Development

```bash
npm install
npm run watch
```

- `npm run watch` builds, runs `npm link`, starts Homebridge in debug mode with `./.homebridge-dev` as the storage folder, and rebuilds and restarts when `src` changes.
- First put a bridge section and this plugin's platform entry (`"platform": "SmartThingsHyundai"`) in `./.homebridge-dev/config.json`. `.homebridge-dev/` is excluded from git.
- This runs without the Homebridge UI, so the OAuth settings screen is not available. Supplementary PAT mode is simpler during development.

### Connecting SmartThings (settings screen)

In the Homebridge UI, open Plugins → this plugin's **Settings**. The **'SmartThings connection'** card is at the top, with the regular options below it. The top of the card shows the current state (app, redirect, connection, token expiry).

#### 1. Prepare the app

**Create app (recommended)**

1. Create a temporary personal access token (PAT) at https://account.smartthings.com/tokens. Select only the app scopes `r:smartapps` and `w:smartapps`.
2. Enter it in the 'Temporary PAT' field and click **'Create app'**.
   - The plugin creates an OAuth app in SmartThings with scopes `r:devices:*`, `x:devices:*` and `sse`, and the redirect URI `https://localhost/callback`.
   - The PAT is used only for this request and is never stored. You can delete it on the tokens page afterwards (it expires by itself after 24 hours).
3. If this Homebridge already has a saved app, no new app is created. If the account has apps that this plugin created earlier but this Homebridge has no record of, another app is created only after you confirm.

**Enter an existing app**

To use an app you created yourself (SmartThings CLI or Developer Center), expand **'Enter an existing app'**, enter the client id, client secret, app id (optional) and redirect URI (empty means `https://localhost/callback`), and click **'Save'**.

- The app must have the scopes `r:devices:*`, `x:devices:*` and `sse` and the redirect URI you entered. The plugin requests these scopes in the login link.
- The app id is needed to change the redirect URI below.

Saving a new app (created or entered) deletes existing tokens, so log in again.

#### 2. Log in

1. Click **'Open login link'**. The SmartThings login and approval page opens in a new window (check your popup blocker). Approve.
2. The browser then goes to `https://localhost/callback?code=…&state=…` and shows a 'cannot connect' page — that is expected. Copy **the whole URL** from the address bar.
3. Paste it into the field and click **'Finish'**.
   - You can paste just the `code` value instead of the whole URL. It is then accepted only for a login started from this settings screen within the last 10 minutes.
   - The login link is valid for 10 minutes; if you close the settings screen, start again.
4. Make sure the authorization method is **OAuth** and restart Homebridge (or the child bridge).

**'Disconnect'** deletes the saved tokens only (the app record stays).

#### Changing the redirect URI

If SmartThings does not accept `https://localhost/callback`, open **'Change the redirect URI (needs the PAT)'**, choose another candidate (`http://localhost:8999/callback` or `http://127.0.0.1:8999/callback`), enter a PAT in the temporary PAT field of step 1 and click **'Update'**. Log in again afterwards. Which candidates SmartThings accepts has not been verified yet.

#### If you get a 403

If 'Create app' is refused with a 403, SmartThings gives no reason, so the plugin cannot tell the cause. Check:

- that the Developer Plan subscription on the account is active
- that the PAT has the `w:smartapps` scope
- that the PAT was issued by the same SmartThings account that holds the subscription
- if the PAT was issued before you subscribed, try again with a new PAT

### Tokens and client credentials

- Location: `smartthings-hyundai/` under the Homebridge storage folder
  - `oauth-app.json` — client id, client secret, app id, redirect URI
  - `oauth-tokens.json` — access token, refresh token, expiry
  - Folder mode 0700, file mode 0600. Files are written to a temporary file and renamed (atomic save), so an interrupted write does not corrupt them.
  - The storage folder is usually `/var/lib/homebridge` (Raspberry Pi image / apt), `/homebridge` (Docker) or `~/.homebridge` (macOS hb-service).
- Refresh: tokens are refreshed automatically 10 minutes before they expire, and the new refresh token is saved right away. Concurrent refreshes are merged into one. A request that gets 401 is retried once after a refresh.
- When a new login is required (a refresh was rejected):
  - The log says 'SmartThings login required. Reconnect in the plugin settings screen.', the settings screen shows '⚠️ Login required again', and the vehicle shows 'No Response' in the Home app.
  - Log in again (step 2) in the settings screen; the plugin reads the new token file and resumes at the next read. No restart is needed.
- If there is no app or token at startup, the plugin logs how to connect and does not start. Restart after connecting.

### Supplementary PAT mode

Set the authorization method to **PAT** in the settings and enter a PAT with the Devices scopes list, see and control.

- PATs issued after 2024-12-30 **expire after 24 hours** and cannot be refreshed. Use this only for testing or if you have a long-lived PAT.
- When the PAT expires, the log explains it and the vehicle shows 'No Response'. Enter a new PAT and restart.
- The PAT is stored as-is in `config.json` (see [Security](#security)).

### Using it in the Home app

#### Run as a child bridge and choose the room while pairing (recommended)

Plugins cannot set the room of an accessory; rooms belong to the Home app. To put the vehicle in a dedicated room (for example, a garage) from the start:

1. In the Homebridge UI, go to Plugins → this plugin's menu → **Bridge Settings** and enable the child bridge.
2. Restart Homebridge.
3. In the Home app, pair the child bridge as a separate bridge (QR code or setup code shown in the Homebridge UI).
4. While pairing, assign the accessory to your vehicle room (for example, **Garage**).

Accessory UUIDs are derived from the SmartThings device ID, so the room and name you choose in the Home app are kept across restarts and updates.

#### Service name language

The service names shown in the Home app (Lock, Climate, Doors, ...) are Korean (`ko`, default) or English (`en`), set with `serviceNameLanguage`. Logs and the settings screen are always bilingual.

- **Choose before pairing.** The Home app may keep the names it stored when the accessory was paired.
- If you change the language after adding the accessory, the plugin switches only the default names and never touches names you changed in the Home app.

#### Vehicle name in front of service names

So that you can tell which vehicle a tile belongs to, the SmartThings vehicle name is put in front of every service name (for example `{vehicle name} Doors`). You can also ask Siri "Are the {vehicle name} doors open?". Turn off `prefixServiceNames` to use only "Doors" as before.

- The name comes from the SmartThings app. Characters the Home app does not accept (emoji, square brackets, ...) are dropped, and if the whole name is longer than 64 characters the vehicle name is shortened. When you rename the vehicle in SmartThings, the default names follow.
- Names you changed in the Home app are never touched.
- Confirmed on a real device: the vehicle name shows in front of the service names. Not yet checked: whether an accessory that is already paired picks up the new names right away, whether names changed in the Home app are kept, whether turning this option off restores the plain names, Siri commands, and whether renaming the vehicle in SmartThings is followed.
- The Home app may hide a first word that matches the room name. If an accessory that is already paired does not show the new names, rename it in the Home app or add the accessory again.

#### Home-wide Siri commands

Siri groups commands by service type, such as "turn on all air conditioners". Putting the vehicle in a separate room does not exclude it from home-wide commands, so turning on the home's air conditioners can also start the vehicle's remote climate (and engine). To prevent this, enable **'Expose climate as a switch'** (`climateAsSwitch`).

### Options

| Key | Description | Default |
|---|---|---|
| `name` | Platform name | `SmartThings Hyundai` |
| `authMethod` | Authorization method: `oauth` or `pat` | `oauth` |
| `personalAccessToken` | PAT. Shown only when the method is `pat` | — |
| `pollingInterval` | Status polling interval in seconds (minimum 60). Shorter values are raised to 60 with a log notice | 60 |
| `allowUnlock` | Allow unlock. When off, unlock requests are rejected | `true` |
| `allowClimate` | Allow remote climate. When off, requests to turn on climate are rejected | `true` |
| `climateAsSwitch` | Expose climate as a switch instead of an air conditioner | `false` |
| `climateTemperature` | Climate temperature (°C, 17–27). Fixed value in switch mode, initial value in air-conditioner mode | 22 |
| `climateDuration` | Climate duration (minutes, 1–30) | 10 |
| `climateDefog` | Windshield defog | `false` |
| `exposeRangeAsLightSensor` | Show driving range as a light sensor (lux = km) | `false` |
| `individualDoorWindowSensors` | One sensor per door and per window | `false` |
| `serviceNameLanguage` | Language of the Home app service names: `ko` or `en`. Unsupported values fall back to `ko` with a log notice | `ko` |
| `prefixServiceNames` | Put the vehicle name in front of service names (for example `{vehicle name} Doors`) | `true` |

The OAuth client id/secret and tokens are not options; they are managed in the settings screen (see [Tokens and client credentials](#tokens-and-client-credentials)).

### Security

- **Why the PAT and client secret are not kept in `config.json`**: `config.json` is plain text, shown as-is in the settings screen's JSON editor, and easy to paste when asking for help or to copy elsewhere. The OAuth client secret and tokens are therefore kept in separate files with mode 0600. Homebridge backups may include these files, so keep backups safe.
- **Least-privilege PATs**: for creating the app, select only `r:smartapps` and `w:smartapps`, and delete the PAT on the tokens page afterwards. For supplementary PAT mode, select only the Devices scopes list, see and control.
- In supplementary PAT mode the PAT is stored in `config.json`. Use OAuth for long-term use.
- The plugin is built not to put the PAT, client secret or tokens in logs or settings-screen messages.

### Safety

- Unlock and remote climate change the real vehicle state. Turning on remote climate may start the engine for the configured duration.
- Turn off `allowUnlock` or `allowClimate` if you want to block those actions.

### Changes

- **0.1.3**: Log times use the local time zone of the Homebridge host, with the UTC offset.
- **0.1.2**: After a refresh, logs 'Refresh complete — data as of …' when newer data arrives.
- **0.1.1**: Vehicle name in front of service names (`prefixServiceNames`, on by default). The settings screen now shows the regular settings form right after installation, and says so when the connection status does not arrive within 10 seconds.
- **0.1.0**: First package.

### License

MIT. See [THIRD_PARTY_NOTICES](./THIRD_PARTY_NOTICES) for third-party notices. This plugin is based on [gomeng-dev/smartthings-vehicle-ha](https://github.com/gomeng-dev/smartthings-vehicle-ha) (MIT).
