import { createApp } from "./app";
import { config } from "./config";

const app = createApp();

app.listen(config.PORT, () => {
  console.log(`Usage quota service listening on port ${config.PORT}`);
});
