"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMirexUserById = getMirexUserById;
exports.getMirexUserByEmail = getMirexUserByEmail;
exports.getImportadexNotificationUsers = getImportadexNotificationUsers;
const pg_1 = require("pg");
let pool = null;
const importadexInstitution = "Importadex / Flypack";
const getPool = () => {
    const connectionString = process.env.MIREX_DATABASE_URL;
    if (!connectionString)
        return null;
    pool ??= new pg_1.Pool({ connectionString });
    return pool;
};
const mapUser = (row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    institution: row.institution,
    active: row.active,
    status: row.status,
});
const activeUserClause = `active = true AND COALESCE(status, 'ACTIVE') = 'ACTIVE'`;
async function getMirexUserById(id) {
    const db = getPool();
    if (!db)
        return null;
    const result = await db.query(`SELECT id, email, name, role::text AS role, institution, active, status
     FROM users
     WHERE id = $1 AND ${activeUserClause}
     LIMIT 1`, [id]);
    return result.rows[0] ? mapUser(result.rows[0]) : null;
}
async function getMirexUserByEmail(email) {
    const db = getPool();
    if (!db)
        return null;
    const result = await db.query(`SELECT id, email, name, role::text AS role, institution, active, status
     FROM users
     WHERE LOWER(email) = LOWER($1) AND ${activeUserClause}
     LIMIT 1`, [email]);
    return result.rows[0] ? mapUser(result.rows[0]) : null;
}
async function getImportadexNotificationUsers() {
    const db = getPool();
    if (!db) {
        console.warn("Importadex notifications skipped: MIREX_DATABASE_URL is missing.");
        return [];
    }
    const result = await db.query(`SELECT id, email, name, role::text AS role, institution, active, status
     FROM users
     WHERE ${activeUserClause}
       AND (
         role::text = 'ADMIN'
         OR (
           role::text = 'OPERACIONES'
           AND LOWER(REPLACE(COALESCE(institution, ''), ' ', '')) = LOWER(REPLACE($1, ' ', ''))
         )
       )
     ORDER BY role::text ASC, name ASC`, [importadexInstitution]);
    return result.rows.map(mapUser);
}
