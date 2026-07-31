import type { Context } from "cordis";
import { z } from "zod";

export const name = "ping";
export const inject = ["db"];

export const Config = z
  .object({
    greeting: z.string().default("hi"),
  })
  .prefault({});

export function apply(ctx: Context, config: z.infer<typeof Config>) {
  ctx.logger.info("ping plugin loaded: %s", config.greeting);
  ctx.effect(() => {
    const timer = setInterval(() => ctx.logger.info("heartbeat"), 30_000);
    return () => clearInterval(timer);
  }, "heartbeat-timer");
}
