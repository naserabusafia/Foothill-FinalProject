import { pool } from "../db/client";
import { PREDEFINED_PLANS, seedPredefinedPlans } from "../db/seed";

seedPredefinedPlans()
  .then(() => console.log(`Seeded ${PREDEFINED_PLANS.length} predefined plans`))
  .catch((err) => {
    console.error("Seed failed", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
