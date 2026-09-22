/**
 * @deprecated
 * MongoDB has been replaced with SQLite in the Python FastAPI backend.
 * All database models and operations are now located in backend/app/db/.
 */

export async function getMongoClient() {
  return null;
}

export async function getDb() {
  return null;
}
