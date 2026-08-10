module.exports = function (RED) {
    "use strict";

    function ShutterNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Config values and their types
        node.deviceUpValue = config.deviceUp;
        node.deviceUpType = config.deviceUpType || "str";
        node.deviceDownValue = config.deviceDown;
        node.deviceDownType = config.deviceDownType || "str";
        node.durationUpValue = config.durationUp;
        node.durationUpType = config.durationUpType || "num";
        node.durationDownValue = config.durationDown;
        node.durationDownType = config.durationDownType || "num";
        node.identifierValue = config.identifier;
        node.identifierType = config.identifierType || "str";
        node.logging = config.logging || false;

        // Internal state
        let timer = null;
        let statusInterval = null;
        let moveTimestamp = null;
        let opening = false;
        let target = -1;
        let progress = 1; // 0 = closed, 1 = fully open

        // ── Property resolution ──

        function resolveDevice(isOpening, msg) {
            if (isOpening) {
                return RED.util.evaluateNodeProperty(
                    node.deviceUpValue, node.deviceUpType, node, msg
                );
            }
            return RED.util.evaluateNodeProperty(
                node.deviceDownValue, node.deviceDownType, node, msg
            );
        }

        function resolveDuration(isOpening, msg) {
            let val;
            if (isOpening) {
                val = RED.util.evaluateNodeProperty(
                    node.durationUpValue, node.durationUpType, node, msg
                );
            } else {
                val = RED.util.evaluateNodeProperty(
                    node.durationDownValue, node.durationDownType, node, msg
                );
            }
            const num = parseInt(val, 10);
            return (num > 0) ? num : 1000;
        }

        function resolveIdentifier(msg) {
            return RED.util.evaluateNodeProperty(
                node.identifierValue, node.identifierType, node, msg
            );
        }

        // ── Global context helpers ──

        function getShuttersConfig() {
            const ctx = node.context().global;
            return ctx.get("shutters_mem") || { unlimited: false, active: [] };
        }

        function setShuttersConfig(val) {
            const ctx = node.context().global;
            ctx.set("shutters_mem", val);
        }

        function isUnlimited() {
            return getShuttersConfig().unlimited || false;
        }

        function updateGlobalStates(msg) {
            const ctx = node.context().global;
            const states = ctx.get("shutters") || {};
            const id = resolveIdentifier(msg);

            if (id) {
                states[id] = {
                    position: progress,
                    changed: Date.now(),
                };
                ctx.set("shutters", states);
            }
        }

        function trackActive(device, state) {
            const status = getShuttersConfig();
            let active = status.active || [];
            const len = active.length;

            if (state) {
                active.push(device);
            } else {
                active = active.filter(function (d) { return d !== device; });
            }

            if (len !== active.length) {
                status.active = active;
                setShuttersConfig(status);
            }
        }

        // ── Status helpers ──

        function buildStatus(active, isOpening) {
            const p = progress;
            let text = "open at " + Math.round(p * 100) + "%";
            let isAtEnd = false;

            if (p <= 0) {
                text = "closed";
                isAtEnd = true;
            } else if (p >= 1) {
                text = "fully opened";
                isAtEnd = true;
            }

            const internal = {
                shape: "ring",
                fill: active ? "red" : "green",
                text: active ? (isOpening ? "opening..." : "closing...") : text,
            };

            const external = {
                status: (active
                    ? (isOpening ? "opening" : "closing")
                    : (isAtEnd ? text : "opened")
                ).replace(" ", "_"),
                position: p,
            };

            const result = { internal: internal, external: external };
            if (!active) {
                result.reset = 1;
            }
            return result;
        }

        function applyStatus(statusObj) {
            node.status(statusObj.internal);
        }

        function sendStatus(statusObj) {
            // Send on second output
            node.send([null, { payload: statusObj.external }]);
        }

        // ── Live status reporting (200ms interval while moving) ──

        function startStatusReporting(msg) {
            stopStatusReporting();

            statusInterval = setInterval(function () {
                if (moveTimestamp === null) {
                    stopStatusReporting();
                    return;
                }

                const elapsed = Date.now() - moveTimestamp;
                const dur = resolveDuration(opening, msg);
                let p = progress + (elapsed / dur) * (opening ? 1 : -1);
                p = Math.max(0, Math.min(1, p));

                const text = (opening ? "opening (" : "closing (") + Math.round(p * 100) + "% open)";
                node.status({ shape: "ring", fill: "red", text: text });

                // Send live position on second output
                node.send([null, { payload: { status: opening ? "opening" : "closing", position: p } }]);
            }, 200);
        }

        function stopStatusReporting() {
            if (statusInterval) {
                clearInterval(statusInterval);
                statusInterval = null;
            }
        }

        // ── Movement control ──

        function buildMessage(device, state, msg) {
            if (!state) {
                updateGlobalStates(msg);
            }
            trackActive(device, state);

            return {
                topic: device,
                info: device + "=" + state,
                payload: state ? 1 : 0,
            };
        }

        function stopMovement(msg) {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            stopStatusReporting();
            moveTimestamp = null;
        }

        function startMovement(device, time, isOpening, msg) {
            moveTimestamp = Date.now();
            opening = isOpening;

            timer = setTimeout(function () {
                timerHandler(device, msg);
            }, time);

            startStatusReporting(msg);

            const statusObj = buildStatus(true, isOpening);
            applyStatus(statusObj);

            node.send([
                buildMessage(device, true, msg),
                { payload: statusObj.external },
            ]);
        }

        function timerHandler(device, msg) {
            timer = null;
            stopStatusReporting();
            moveTimestamp = null;

            if (target >= 0) {
                progress = target;
                target = -1;
            } else {
                progress = opening ? 1 : 0;
            }

            log(device + ": finished " + (opening ? "opening" : "closing"));

            const statusObj = buildStatus(false, false);
            applyStatus(statusObj);

            node.send([
                buildMessage(device, false, msg),
                { payload: statusObj.external },
            ]);
        }

        // ── Logging ──

        function log(text) {
            if (node.logging) {
                node.warn(text);
            }
        }

        // ── Input handler ──

        node.on("input", function (msg, send, done) {
            const UNLIMITED = isUnlimited();
            let position = -1;
            let isOpening = msg.direction === "up";

            // Status query
            if (msg.get_status !== undefined) {
                const statusObj = buildStatus(false, false);
                applyStatus(statusObj);
                sendStatus(statusObj);
                if (done) done();
                return;
            }

            // Percentage-based positioning
            if (msg.direction === undefined && msg.payload !== undefined && Number.isInteger(msg.payload)) {
                position = msg.payload;

                if (target === -1) {
                    log("set open to " + position + "%");
                }

                position = position / 100;

                if (position !== progress) {
                    isOpening = position >= progress;
                }
            }

            let device;
            try {
                device = resolveDevice(isOpening, msg);
            } catch (e) {
                node.error("Failed to resolve device: " + e.message, msg);
                if (done) done(e);
                return;
            }

            const wasOpening = opening;
            const changeDirection = wasOpening !== isOpening && !UNLIMITED;
            let time;

            opening = isOpening;

            // If currently moving, stop first
            if (timer) {
                clearTimeout(timer);

                const elapsed = Date.now() - moveTimestamp;
                let dur;
                try {
                    dur = resolveDuration(wasOpening, msg);
                } catch (e) {
                    node.error("Failed to resolve duration: " + e.message, msg);
                    if (done) done(e);
                    return;
                }

                progress += (elapsed / dur) * (wasOpening ? 1 : -1);
                progress = Math.max(0, Math.min(1, progress));

                timer = null;
                stopStatusReporting();
                moveTimestamp = null;

                const prevDevice = resolveDevice(wasOpening, msg);
                log(prevDevice + ": stopped " + (wasOpening ? "opening" : "closing") + " at " + (progress * 100).toFixed(2) + "%");

                const statusObj = buildStatus(false, false);
                applyStatus(statusObj);

                node.send([
                    buildMessage(prevDevice, false, msg),
                    { payload: statusObj.external },
                ]);

                // Handle direction change (relay switch needs a new command)
                if (changeDirection && position < 0) {
                    let dur2;
                    try {
                        dur2 = resolveDuration(isOpening, msg);
                    } catch (e) {
                        node.error("Failed to resolve duration: " + e.message, msg);
                        if (done) done(e);
                        return;
                    }

                    time = Math.round(progress * dur2);
                    if (isOpening) {
                        time = dur2 - time;
                    }

                    log(device + ": change, time=" + time + ", " + (isOpening ? "opening" : "closing"));
                    startMovement(device, time, isOpening, msg);

                    if (done) done();
                    return;
                }
            } else {
                // Not currently moving - start new movement
                let dur;
                try {
                    dur = resolveDuration(isOpening, msg);
                } catch (e) {
                    node.error("Failed to resolve duration: " + e.message, msg);
                    if (done) done(e);
                    return;
                }

                if (position < 0) {
                    // Direction-based: move fully in that direction
                    time = progress * dur;
                    if (isOpening) {
                        time = dur - time;
                    }
                } else {
                    // Position-based: move to target
                    if (position !== progress || UNLIMITED) {
                        time = (!UNLIMITED ? Math.abs(progress - position) : 1) * dur;
                        isOpening = position >= progress;
                        opening = isOpening;
                        device = resolveDevice(isOpening, msg);
                        target = position;
                    } else {
                        log(device + ": already at " + (position * 100) + "%");
                        updateGlobalStates(msg);

                        const statusObj = buildStatus(false, false);
                        applyStatus(statusObj);
                        sendStatus(statusObj);

                        if (done) done();
                        return;
                    }
                }

                time = Math.round(time);
                log(device + ": time=" + time + ", progress=" + (progress * 100).toFixed(2) + "%");

                if (time > 0 && (UNLIMITED || (isOpening && progress < 1) || (!isOpening && progress > 0))) {
                    startMovement(device, time, isOpening, msg);
                } else {
                    log(device + ": already fully " + (isOpening ? "opened" : "closed"));
                    updateGlobalStates(msg);

                    const statusObj = buildStatus(false, false);
                    applyStatus(statusObj);
                    sendStatus(statusObj);
                }
            }

            if (done) done();
        });

        node.on("close", function () {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            stopStatusReporting();
        });
    }

    RED.nodes.registerType("shutter", ShutterNode);
};
