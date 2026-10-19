import express from "express";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { accountsRouter } from "./modules/accounts/accounts.routes";
import { consumptionsRouter } from "./modules/consumptions/consumptions.routes";
import { plansRouter } from "./modules/plans/plans.routes";
import { usersRouter } from "./modules/users/users.routes";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Routers that call router.use(apiKeyAuth) are mounted under their own prefix,
  // so their auth applies only to their paths.
  app.use(accountsRouter);
  app.use("/plans", plansRouter);
  app.use("/users", usersRouter);
  app.use("/consumptions", consumptionsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
