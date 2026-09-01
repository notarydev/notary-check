// Cloudflare Worker entry that fronts the engine's Docker container. The
// Worker itself does no application logic — it only starts/routes to
// container instances and forwards HTTP requests. All real behavior lives in
// src/server.ts, unchanged, running inside the container.
import { Container, getRandom } from "@cloudflare/containers";

export interface Env {
  NOTARY_ENGINE: DurableObjectNamespace<NotaryEngineContainer>;
  DATABASE_URL: string;
  DEEPSEEK_API_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_PUBLISHABLE_KEY: string;
  STRIPE_WEBHOOK_SECRET?: string;
}

export class NotaryEngineContainer extends Container<Env> {
  defaultPort = 4001;
  sleepAfter = "30m";

  constructor(ctx: DurableObject["ctx"], env: Env) {
    super(ctx, env);
    this.envVars = {
      DATABASE_URL: env.DATABASE_URL,
      DEEPSEEK_API_KEY: env.DEEPSEEK_API_KEY,
      STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY,
      STRIPE_PUBLISHABLE_KEY: env.STRIPE_PUBLISHABLE_KEY,
      STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET ?? "",
      PORT: "4001",
    };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const container = await getRandom(env.NOTARY_ENGINE, 2);
    return container.fetch(request);
  },
};
