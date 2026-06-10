"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const crypto_1 = require("crypto");
const connectionDB_1 = require("../src/config/connectionDB");
const catalogs = {
    operation_type: [
        ["IMPORT", "Importacion"],
        ["EXPORT", "Exportacion"],
        ["TRANSIT", "Transito"],
        ["CUSTOMS_CLEARANCE", "Despacho aduanal"],
        ["LOCAL_TRANSPORT", "Transporte local"],
    ],
    transport_mode: [
        ["SEA", "Maritimo"],
        ["AIR", "Aereo"],
        ["LAND", "Terrestre"],
        ["MULTIMODAL", "Multimodal"],
    ],
    cargo_type: [
        ["CONTAINERIZED", "Contenerizada"],
        ["LOOSE", "Carga suelta"],
        ["PALLETIZED", "Carga paletizada"],
        ["NON_PALLETIZED", "Carga no paletizada"],
        ["LCL", "Carga consolidada LCL"],
        ["BREAKBULK", "Breakbulk"],
    ],
    document_type: [
        ["COMMERCIAL_INVOICE", "Factura comercial"],
        ["PACKING_LIST", "Packing list"],
        ["BL", "BL"],
        ["AWB", "AWB"],
        ["CUSTOMS_DECLARATION", "Declaracion aduanal"],
    ],
    incident_type: [
        ["MISSING_DOCUMENTS", "Documentos incompletos"],
        ["PERMIT_PENDING", "Permiso pendiente"],
        ["PORT_DELAY", "Demora en puerto"],
        ["DAMAGED_CARGO", "Carga averiada"],
        ["PAYMENT_PENDING", "Pago pendiente"],
    ],
    party: [
        ["CLIENTS", "Clientes"],
        ["PROVIDERS", "Proveedores"],
        ["CARRIERS", "Navieras"],
        ["AIRLINES", "Aerolineas"],
        ["CUSTOMS_AGENTS", "Agentes aduanales"],
        ["TRANSPORTERS", "Transportistas"],
    ],
};
async function upsertCatalogs() {
    for (const [group, rows] of Object.entries(catalogs)) {
        for (const [value, label] of rows) {
            await connectionDB_1.prisma.$executeRawUnsafe(`INSERT INTO importadex_catalogs (id, "group", value, label)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT ("group", value) DO UPDATE SET label = EXCLUDED.label, active = true`, (0, crypto_1.randomUUID)(), group, value, label);
        }
    }
}
async function seedOperation() {
    const id = (0, crypto_1.randomUUID)();
    const existing = await connectionDB_1.prisma.$queryRawUnsafe("SELECT id FROM importadex_operations WHERE code = $1", "IMP-2407-018");
    if (existing.length > 0)
        return existing[0].id;
    await connectionDB_1.prisma.$executeRawUnsafe(`INSERT INTO importadex_operations (
      id, code, client_name, operation_type, transport_mode, cargo_type, status,
      customs_status, priority, origin, destination, port, carrier, reference, eta, progress
    )
    VALUES ($1, $2, $3, 'IMPORT', 'SEA', 'CONTAINERIZED', 'IN_CUSTOMS', $4, $5, $6, $7, $8, $9, $10, $11, $12)`, id, "IMP-2407-018", "Repuestos Andinos", "Documentos en revision", "Alta", "Ningbo, CN", "La Paz, BO", "Arica", "MSC", "BL MSCU9328741", new Date("2026-06-14T00:00:00.000Z"), 62);
    return id;
}
async function seedChildren(operationId) {
    const countRows = await connectionDB_1.prisma.$queryRawUnsafe("SELECT COUNT(*)::int AS total FROM importadex_events WHERE operation_id = $1", operationId);
    if ((countRows[0]?.total ?? 0) > 0)
        return;
    await connectionDB_1.prisma.$executeRawUnsafe(`INSERT INTO importadex_containers (id, operation_id, number, type, seal, carrier, free_days, return_limit, status)
     VALUES ($1, $2, $3, $4, $5, $6, 7, $7, $8)`, (0, crypto_1.randomUUID)(), operationId, "MSCU8734210", "40HC", "SL-90412", "MSC", new Date("2026-06-23T00:00:00.000Z"), "Pendiente de devolucion");
    await connectionDB_1.prisma.$executeRawUnsafe(`INSERT INTO importadex_cargo_items (id, operation_id, package_type, pieces, pallets, weight_kg, volume_cbm, handling)
     VALUES ($1, $2, $3, 84, 18, 21480, 58, $4)`, (0, crypto_1.randomUUID)(), operationId, "Carga paletizada", "Montacargas");
    for (const [name, type, status, owner] of [
        ["Factura comercial", "Aduanal", "RECEIVED", "Cliente"],
        ["Packing list", "Aduanal", "RECEIVED", "Cliente"],
        ["Liberacion naviera", "Naviera", "PENDING", "Operaciones"],
    ]) {
        await connectionDB_1.prisma.$executeRawUnsafe(`INSERT INTO importadex_documents (id, operation_id, name, type, status, owner)
       VALUES ($1, $2, $3, $4, $5, $6)`, (0, crypto_1.randomUUID)(), operationId, name, type, status, owner);
    }
    await connectionDB_1.prisma.$executeRawUnsafe(`INSERT INTO importadex_customs_files (id, operation_id, declaration_no, regime, channel, status, responsible)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`, (0, crypto_1.randomUUID)(), operationId, "DIM-2026-9182", "Importacion consumo", "Rojo", "PENDING_REVIEW", "Aduanas");
    await connectionDB_1.prisma.$executeRawUnsafe(`INSERT INTO importadex_incidents (id, operation_id, type, severity, status, owner, description)
     VALUES ($1, $2, $3, 'MEDIUM', 'OPEN', $4, $5)`, (0, crypto_1.randomUUID)(), operationId, "Pago pendiente", "Aduanas", "Esperando confirmacion de pago del cliente.");
    for (const [event, owner, location, date] of [
        ["BL recibido", "Operaciones", "La Paz", "2026-06-03T09:20:00.000Z"],
        ["Arribo confirmado", "Naviera", "Arica", "2026-06-06T16:10:00.000Z"],
        ["Documentos enviados a revision aduanal", "Aduanas", "La Paz", "2026-06-08T11:35:00.000Z"],
    ]) {
        await connectionDB_1.prisma.$executeRawUnsafe(`INSERT INTO importadex_events (id, operation_id, event, owner, location, event_date)
       VALUES ($1, $2, $3, $4, $5, $6)`, (0, crypto_1.randomUUID)(), operationId, event, owner, location, new Date(date));
    }
}
async function main() {
    await upsertCatalogs();
    const operationId = await seedOperation();
    await seedChildren(operationId);
}
main()
    .then(async () => {
    await connectionDB_1.prisma.$disconnect();
})
    .catch(async (error) => {
    console.error(error);
    await connectionDB_1.prisma.$disconnect();
    process.exit(1);
});
