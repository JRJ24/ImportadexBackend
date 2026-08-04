"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeSocket = void 0;
const socket_io_1 = require("socket.io");
const origin = process.env.NODE_ENV === "PROD"
    ? process.env.URL_FRONTEND
    : process.env.URL_FRONTEND || "http://localhost:5173";
const allowedOrigins = origin?.split(/[,;\s]+/).filter(Boolean);
const initializeSocket = (server) => {
    const io = new socket_io_1.Server(server, {
        cors: {
            origin: allowedOrigins?.length ? allowedOrigins : true,
            credentials: true,
        },
    });
    io.on("connection", (socket) => {
        socket.on("importadex:join-operations", () => {
            socket.join("importadex:operations");
        });
        socket.on("importadex:join-client", (clientId) => {
            if (clientId)
                socket.join(`importadex:client:${clientId}`);
        });
    });
    return io;
};
exports.initializeSocket = initializeSocket;
