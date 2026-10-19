import { Router } from "express";
import { apiKeyAuth, getAccountId } from "../../middleware/apiKeyAuth";
import { validate } from "../../shared/validation";
import { assignPlanSchema } from "../plans/plans.schemas";
import { createUserSchema, listUsersQuerySchema, userIdParamsSchema } from "./users.schemas";
import { changeUserPlan, createUser, getUserDetailsOrThrow, listUsers } from "./users.service";

/** Mounted at /users. Every route needs an account API key and only sees that account's users. */
export const usersRouter = Router();
usersRouter.use(apiKeyAuth);

usersRouter.post("/", async (req, res) => {
  const input = validate(createUserSchema, req.body ?? {});
  res.status(201).json(await createUser(getAccountId(req), input));
});

/** ?limit=&cursor=&externalId= */
usersRouter.get("/", async (req, res) => {
  const query = validate(listUsersQuerySchema, req.query);
  res.json(await listUsers(getAccountId(req), query));
});

/** The user and the plan currently applied to them. */
usersRouter.get("/:id", async (req, res) => {
  const { id } = validate(userIdParamsSchema, req.params);
  res.json(await getUserDetailsOrThrow(getAccountId(req), id));
});

usersRouter.patch("/:id/plan", async (req, res) => {
  const { id } = validate(userIdParamsSchema, req.params);
  const { planId } = validate(assignPlanSchema, req.body ?? {});
  res.json(await changeUserPlan(getAccountId(req), id, planId));
});
