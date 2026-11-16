import { createAgentApp } from "./app.ts";
import { type AgentConfig, loadConfig } from "./config.ts";
import { AccountStore } from "./store.ts";

function main(): void {
  let config: AgentConfig;
  try {
    config = loadConfig();
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  const server = createAgentApp(config, new AccountStore(config.configDir));
  server.listen(config.port, config.host, () => {
    console.log(
      JSON.stringify({
        msg: "account-agent berjalan",
        port: config.port,
        domain: config.domain,
      }),
    );
  });

  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) return;
    closing = true;
    console.log(JSON.stringify({ msg: "menutup layanan", signal }));
    const force = setTimeout(() => process.exit(1), 5000);
    force.unref();
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main();
