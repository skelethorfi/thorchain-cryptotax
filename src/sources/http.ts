import axios from "axios";
import axiosThrottle from "axios-request-throttle";

// The one HTTP client for Midgard, THORNode and the TCY distribution API, passed to the xchainjs API clients
// too. The public gateways (Liquify, Maya's Midgard) return occasional 502/504s and sometimes hang: a request
// that hangs fails after the timeout instead of stalling the run, and the throttle keeps under their rate
// limits. Retries are withRetry's, around each store fetch.
export const http = axios.create({timeout: 60_000});

axiosThrottle.use(http, {requestsPerSecond: 1});
