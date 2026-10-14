# Load test (k6)

`k6-load.js` drives the real API with three traffic mixes at once: anonymous browsing, signed-in activity, and concurrent **encrypted streaming**
(playback session -> master and variant playlists -> key -> segments -> progress -> heartbeat -> end).

```bash
brew install k6                                   # or see https://k6.io/docs/get-started/installation/
# stack with the DEV adapters (OTP outbox + simulated payments) and seeded content, API rate limits lifted:
THROTTLE_LIMIT=1000000 AUTH_RATE_LIMIT_SCALE=1000 node backend/dist/main.js
k6 run -e API=http://localhost:3000/api/v1 loadtest/k6-load.js
# scale it:  -e BROWSE_VUS=200 -e AUTHED_VUS=50 -e STREAM_VUS=50 -e USERS=50 -e DURATION=3m
```
Lift the rate limits or you will be measuring the rate limiter (which is doing its job: every viewer in a real test shares one IP).
Thresholds are in the script (p95 browse < 400 ms, signed-in < 600 ms, playback session < 800 ms, key < 400 ms, segment < 800 ms, < 1% failures).

## What the first run showed (14 Oct 2026)
100 browsing + 30 signed-in + 30 streaming virtual users for 60 s: **40,202 requests (~460/s), 0 failed, all checks passed**, p95 of 5 ms overall,
17 ms for creating a playback session, 6 ms for the key and 10 ms for a segment.

**Read this before trusting those numbers.** k6 and the server shared one laptop; storage was the local disk (no S3 or CDN latency); no TLS, no network,
one API instance, a tiny dataset, rate limits lifted. It proves the system behaves correctly under concurrency (no errors, no stuck sessions, no
deadlocks, stream limits respected). It does **not** tell you production capacity. Before launch run it from a separate machine against a
production-like environment (managed MySQL/Redis, S3/R2 and CDN, TLS) and add a heavier transcoding scenario (many simultaneous uploads).

## Findings that came out of writing it
- Watch progress is only accepted during a live playback session (`409 PLAYBACK_REQUIRED` otherwise): working as designed.
- HLS key URIs are relative to the variant playlist (`../enc.key`); clients must resolve them against it (hls.js and Safari do).
