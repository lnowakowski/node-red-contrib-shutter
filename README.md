# node-red-contrib-shutter

[![Node-RED](https://img.shields.io/badge/Node--RED->=4.0.0-red?logo=nodered)](https://nodered.org)
[![Node.js](https://img.shields.io/badge/Node.js->=20-green?logo=nodedotjs)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A Node-RED node for controlling roller shutters (blinds) via two relay outputs (up/down), with time-based position tracking, percentage-based targeting, and live status reporting.

## Features

- Two-relay motor control (separate up/down relays)
- Time-based position estimation (no hardware feedback required)
- Percentage-based positioning (move to 0–100%)
- Skips movement when already at the requested position
- Live position reporting every 200ms while moving
- State coordination across multiple shutters (flow or global context)
- "Unlimited" mode for calibration
- Configurable relay payloads (number, string, or boolean)
- Device, duration, and identifier support dynamic sources (str/num, msg, flow, global, env)
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
| Identifier | string | _(required)_ | Unique name for this shutter (used as its key in the States context) |
| Device up | string | _(required)_ | Relay device identifier for the "open" direction |
| Device down | string | _(required)_ | Relay device identifier for the "close" direction |
| Duration up | number | `1000` | Time in milliseconds for a full open cycle |
| Duration down | number | `1000` | Time in milliseconds for a full close cycle |
| Payload on | number \| string \| bool | `1` | Value sent on output 1 to energize the relay |
| Payload off | number \| string \| bool | `0` | Value sent on output 1 to release the relay |
| States | flow \| global | `shutters` (flow) | Context variable holding the persistent position map |
| Runtime | flow \| global | `shutters_runtime` (flow) | Context variable holding runtime coordination state |
| Logging | boolean | `false` | Enable debug logging to Node-RED debug sidebar |

The Device and Duration properties support dynamic value sources via typed inputs:

| Source | Description |
|--------|-------------|
| `str` / `num` | Static string or number value |
| `msg` | Read from a message property |
| `flow` | Read from flow context |
| `global` | Read from global context |
| `env` | Read from an environment variable |

The **Identifier** is a plain string. The **Payload on / off** values accept a static number, string, or boolean. **States** and **Runtime** are each selected as a `flow` or `global` context variable.

## How It Works

```
                   ┌──────────────────────────────────┐
                   │            shutter               │
    payload:75  ──▶│  Status: opening (42% open)      │──▶ Output 1: relay cmd
                   │                                  │──▶ Output 2: status
                   └──────────────────────────────────┘
```

### Position Tracking

Since typical roller shutters don't provide position feedback, this node **estimates position by timing**:

- Position `0` = fully closed
- Position `1` = fully open
- The node tracks elapsed time vs. configured duration to calculate current position

### Movement Modes

#### Position mode

Send `msg.payload` as an integer percentage (0–100):

```json
{ "payload": 75 }
```

The node calculates the required direction and movement time automatically, and
does nothing if the shutter is already at the requested position. Non-integer
payloads are ignored with a warning.

#### Status query

Send a message with `get_status` property (any value) to get current status without moving:

```json
{ "get_status": true }
```

### Interrupting a movement

If a command arrives while the shutter is already moving, the current relay is
turned **off** and the estimated position is updated based on elapsed time. Send
a new target position afterwards to continue moving.

## Outputs

### Output 1 — Relay Command

| Property | Type | Description |
|----------|------|-------------|
| `msg.topic` | string | Device identifier (up or down relay) |
| `msg.payload` | number \| string \| bool | Configurable **Payload on** (energize) / **Payload off** (release) values, default `1` / `0` |
| `msg.info` | string | e.g. `"device_up=true"` |

### Output 2 — Status

| Property | Type | Description |
|----------|------|-------------|
| `msg.payload.status` | string | `"opening"`, `"closing"`, `"closed"`, `"fully_opened"`, or `"opened"` |
| `msg.payload.position` | number | Current position `0` (closed) to `1` (fully open) |

While moving, status messages are emitted every **200ms** with live position estimates.

## Context

The node maintains shared state for coordination across multiple shutter nodes,
stored in two context variables configured per node: **States** (persistent
position map) and **Runtime** (runtime coordination state). Each is a `flow` or
`global` context variable. Nodes that point at the same variables coordinate with
each other.

### States (default `shutters`, persistent)

Position map for all shutters:

```json
{
    "living_room": { "position": 0.75, "changed": 1700000000000 },
    "bedroom": { "position": 0, "changed": 1700000001000 }
}
```

### Runtime (default `shutters_runtime`)

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
    { "id": "i1", "type": "inject", "payload": "100", "payloadType": "num", "wires": [["s1"]] },
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
