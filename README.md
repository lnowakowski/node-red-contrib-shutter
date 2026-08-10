# node-red-contrib-shutter

[![Node-RED](https://img.shields.io/badge/Node--RED->=4.0.0-red?logo=nodered)](https://nodered.org)
[![Node.js](https://img.shields.io/badge/Node.js->=20-green?logo=nodedotjs)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A Node-RED node for controlling roller shutters (blinds) via two relay outputs (up/down), with time-based position tracking, percentage-based targeting, direction reversal, and live status reporting.

## Features

- Two-relay motor control (separate up/down relays)
- Time-based position estimation (no hardware feedback required)
- Percentage-based positioning (move to 0–100%)
- Direction-based commands (open/close fully)
- Automatic direction reversal handling
- Live position reporting every 200ms while moving
- Global state coordination across multiple shutters
- "Unlimited" mode for calibration
- All properties support dynamic sources (str, msg, flow, global, env)
- No external dependencies

## Installation

Install via the Node-RED **Manage Palette** menu, or from your Node-RED user directory:

```bash
npm install @lnowakowski/node-red-contrib-shutter
```

Restart Node-RED after installation.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| Identifier | string | _(required)_ | Unique name for this shutter (used in global state) |
| Device up | string | _(required)_ | Relay device identifier for the "open" direction |
| Device down | string | _(required)_ | Relay device identifier for the "close" direction |
| Duration up | number | `1000` | Time in milliseconds for a full open cycle |
| Duration down | number | `1000` | Time in milliseconds for a full close cycle |
| Logging | boolean | `false` | Enable debug logging to Node-RED debug sidebar |

All properties (except Logging) support dynamic value sources via typed inputs:

| Source | Description |
|--------|-------------|
| `str` / `num` | Static string or number value |
| `msg` | Read from a message property |
| `flow` | Read from flow context |
| `global` | Read from global context |
| `env` | Read from an environment variable |

## How It Works

```
                   ┌──────────────────────────────────┐
                   │            shutter               │
 direction:"up" ──▶│                                  │──▶ Output 1: relay cmd
 or payload:75  ──▶│  Status: opening (42% open)      │──▶ Output 2: status
                   │                                  │
                   └──────────────────────────────────┘
```

### Position Tracking

Since typical roller shutters don't provide position feedback, this node **estimates position by timing**:

- Position `0` = fully closed
- Position `1` = fully open
- The node tracks elapsed time vs. configured duration to calculate current position

### Movement Modes

#### Direction mode

Send `msg.direction` as `"up"` or `"down"`:

```json
{ "direction": "up" }
```

The shutter moves fully in that direction. If already moving, sending a command **stops** at the current position. Sending the opposite direction triggers a reversal.

#### Position mode

Send `msg.payload` as an integer percentage (0–100):

```json
{ "payload": 75 }
```

The node calculates the required direction and movement time automatically.

#### Status query

Send a message with `get_status` property (any value) to get current status without moving:

```json
{ "get_status": true }
```

### Direction Reversal

When a command arrives in the opposite direction while moving:

1. The current relay is turned **off**
2. Position is updated based on elapsed time
3. The new direction relay is turned **on** with the calculated remaining time

## Outputs

### Output 1 — Relay Command

| Property | Type | Description |
|----------|------|-------------|
| `msg.topic` | string | Device identifier (up or down relay) |
| `msg.payload` | number | `1` = energize relay, `0` = release |
| `msg.info` | string | e.g. `"device_up=true"` |

### Output 2 — Status

| Property | Type | Description |
|----------|------|-------------|
| `msg.payload.status` | string | `"opening"`, `"closing"`, `"closed"`, `"fully_opened"`, or `"opened"` |
| `msg.payload.position` | number | Current position `0` (closed) to `1` (fully open) |

While moving, status messages are emitted every **200ms** with live position estimates.

## Global Context

The node maintains shared state for coordination across multiple shutter nodes:

### `global.shutters` (persistent)

Position map for all shutters:

```json
{
    "living_room": { "position": 0.75, "changed": 1700000000000 },
    "bedroom": { "position": 0, "changed": 1700000001000 }
}
```

### `global.shutters_mem` (runtime)

Runtime coordination state:

```json
{
    "unlimited": false,
    "active": ["relay_up_1"]
}
```

Set `unlimited: true` to disable position limits (useful for calibration or shutters without end stops).

## Example Flow

An example flow is included in the `examples/` folder and available in the Node-RED editor under **Import** → **Examples** → **@lnowakowski/node-red-contrib-shutter**.

```json
[
    { "id": "i1", "type": "inject", "payload": "{\"direction\":\"up\"}", "payloadType": "json", "wires": [["s1"]] },
    { "id": "i2", "type": "inject", "payload": "50", "payloadType": "num", "wires": [["s1"]] },
    { "id": "s1", "type": "shutter", "identifier": "living_room", "deviceUp": "relay_up_1", "deviceDown": "relay_down_1", "durationUp": "20000", "durationDown": "18000", "wires": [["mqtt1"], ["debug1"]] },
    { "id": "mqtt1", "type": "mqtt out", "topic": "" },
    { "id": "debug1", "type": "debug", "complete": "payload" }
]
```

## License

[MIT](LICENSE)

## Links

- [GitHub Repository](https://github.com/lnowakowski/node-red-contrib-shutter)
- [Node-RED](https://nodered.org)
