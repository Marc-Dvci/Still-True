// The Workers test runtime exposes this Worker's bindings as `env` from "cloudflare:test".
import type { Env as WorkerEnv } from "../../src/env";

declare global {
  namespace Cloudflare {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface Env extends WorkerEnv {}
  }
}

export {};
