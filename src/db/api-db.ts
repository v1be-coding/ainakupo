import { connect } from "./client.js";

export type ApiDb = ReturnType<typeof connect>;

let db: ApiDb | undefined;

// One connection per Lambda container, made on first use so a cold start that
// never touches the database (health, 405, 404) doesn't open one.
export function apiDb(): ApiDb {
  if (!db) {
    const user = process.env.DB_USER;
    if (!user) throw new Error("DB_USER isn't set");
    db = connect(user);
  }
  return db;
}
