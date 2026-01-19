import { Transform } from "stream";

export function createSpeedMonitorStream(minSpeed, duration) {
    // If no limits set, return a pass-through
    if (!minSpeed || !duration) {
        return new Transform({
            transform(chunk, encoding, callback) {
                callback(null, chunk);
            },
        });
    }

    let currentBytes = 0;
    let belowLimitSeconds = 0;
    let isActive = true;

    const monitor = new Transform({
        transform(chunk, encoding, callback) {
            currentBytes += chunk.length;
            callback(null, chunk);
        },
        flush(callback) {
            isActive = false;
            clearInterval(intervalId);
            callback();
        },
    });

    const intervalId = setInterval(() => {
        if (!isActive) {
            clearInterval(intervalId);
            return;
        }

        // Check speed for this second
        const speed = currentBytes; // since interval is 1s
        if (speed < minSpeed) {
            belowLimitSeconds++;
        } else {
            belowLimitSeconds = 0;
        }

        // Reset counter for next second
        currentBytes = 0;

        if (belowLimitSeconds >= duration) {
            clearInterval(intervalId);
            monitor.destroy(
                new Error(
                    `Operation too slow. Less than ${minSpeed} bytes/sec transferred the last ${duration} seconds`,
                ),
            );
        }
    }, 1000);

    // Clean up on error or close
    monitor.on("close", () => clearInterval(intervalId));
    monitor.on("error", () => clearInterval(intervalId));

    return monitor;
}
