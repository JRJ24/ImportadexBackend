"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const morgan = __importStar(require("morgan"));
const cors_1 = __importDefault(require("cors"));
const connectionDB_1 = require("./config/connectionDB");
const Routes_1 = __importDefault(require("./Routes"));
const Socket_1 = require("./Socket");
const path_1 = __importDefault(require("path"));
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
app.use((0, cors_1.default)());
app.use(morgan.default("dev"));
app.use(express_1.default.urlencoded({ extended: true }));
app.use(express_1.default.static(path_1.default.join(__dirname, "public")));
app.use(express_1.default.json());
app.use("/api", Routes_1.default);
app.use((req, res) => {
    res.status(404).json({
        message: "Route not found",
    });
});
app.use((error, req, res, next) => {
    console.error(error);
    res.status(500).json({
        message: "Internal server error",
    });
});
if (process.env.NODE_ENV === "PROD") {
    app.set("trust proxy", 1);
}
const PORT = process.env.PORT || 5000;
const startServer = async () => {
    try {
        await connectionDB_1.prisma.$connect();
        const io = (0, Socket_1.initializeSocket)(server);
        app.set("socketio", io);
        server.listen(PORT, () => {
            console.log(`Server running on http://localhost:${PORT}`);
        });
    }
    catch (error) {
        console.error("Failed to start server:", error);
        await connectionDB_1.prisma.$disconnect();
        process.exit(1);
    }
};
const shutdown = async () => {
    console.log("Shutting down server...");
    server.close(async () => {
        await connectionDB_1.prisma.$disconnect();
        process.exit(0);
    });
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
startServer();
