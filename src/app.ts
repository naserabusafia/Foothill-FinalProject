import express from "express";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { accountsRouter } from "./modules/accounts/accounts.routes";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use(accountsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
