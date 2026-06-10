"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeSocket = void 0;
const socket_io_1 = require("socket.io");
const origin = process.env.NODE_ENV === "PROD"
    ? process.env.URL_FRONTEND
    : "http://localhost:5173/";
const initializeSocket = (server) => {
    const io = new socket_io_1.Server(server, {
        cors: {
            origin: origin,
            credentials: true,
        },
    });
    io.on("connection", (socket) => {
        // socket.on("join-private-room", (userEmail: string) => {
        //   socket.join(userEmail);
        // });
        // socket.on("New-Comment", (data) => {
        //   io.emit("Comment-Received", data);
        // });
    });
    return io;
};
exports.initializeSocket = initializeSocket;
