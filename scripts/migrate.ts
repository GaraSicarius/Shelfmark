import { closeDb, runMigrations } from "../lib/db.ts";

runMigrations()
  .then(() => closeDb())
  .then(() => {
    console.log("Migrations applied.");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
