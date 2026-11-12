// Small in-memory fixed-window rate limiter.
//
// The app runs as a single Node process, so in-memory counters are sufficient. If it is ever
// scaled to several processes, move these counters to a shared store.
//
// School computer labs usually share one public IP address (NAT), so per-IP limits must stay
// generous. Login limits therefore count *failed* attempts only, and student logins are keyed by
// IP + identifier so one student's typos cannot lock out the rest of the class.

const SWEEP_INTERVAL_MS = 60_000;
const limiters = new Set();

const sweepTimer = setInterval(() => {
  const now = Date.now();
  for (const buckets of limiters) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) {
        buckets.delete(key);
      }
    }
  }
}, SWEEP_INTERVAL_MS);
sweepTimer.unref?.();

/**
 * @param {object} options
 * @param {number} options.windowMs
 * @param {number} options.max
 * @param {(req) => string} options.key        Bucket key; return '' to skip limiting.
 * @param {'all' | 'failures'} [options.count] Count every request, or only responses >= 400.
 * @param {string} [options.message]
 */
export function createRateLimiter({ windowMs, max, key, count = 'all', message }) {
  const buckets = new Map();
  limiters.add(buckets);

  function getBucket(bucketKey, now) {
    let bucket = buckets.get(bucketKey);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(bucketKey, bucket);
    }
    return bucket;
  }

  return function rateLimitMiddleware(req, res, next) {
    const bucketKey = key(req);
    if (!bucketKey) {
      next();
      return;
    }

    const now = Date.now();
    const bucket = getBucket(bucketKey, now);
    if (bucket.count >= max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        error:
          message ??
          `Too many attempts. Please wait ${Math.ceil(retryAfterSeconds / 60)} minute(s) and try again.`,
        retryAfterSeconds,
      });
      return;
    }

    if (count === 'all') {
      bucket.count += 1;
    } else {
      res.on('finish', () => {
        if (res.statusCode >= 400 && res.statusCode !== 429) {
          getBucket(bucketKey, Date.now()).count += 1;
        }
      });
    }

    next();
  };
}

export function clientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || 'unknown');
}
