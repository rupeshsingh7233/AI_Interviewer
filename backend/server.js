import express from "express";
import http from "http"
import dotenv from "dotenv";
import cors from "cors";
import { Server } from "socket.io";
import connectDB from "./config/db.js";
import userRoutes from "./routes/userRoutes.js";
// import sessionRoutes from "./routes/sessionRoutes.js";
import { notFound, errorHandler } from "./middleware/errorMiddleware.js";

dotenv.config();

connectDB(); 

const app = express();
const server = http.createServer(app);

const allowOrigin = [
    "http://localhost:7233",
    "http://localhost:7233",
]

const io = new Server(server, {
    cors: {
        origin: allowOrigin,
        methods: ["GET", "POST","PUT", "DELETE","PATCH","OPTIONS"],
        credentials: true,
        allowedHeaders: ["Content-Type", "Authorization"],
    }
})
app.use(cors({
    origin: (origrin, callback) => {
        if (!origrin) return callback(null, true)
        if (allowOrigin.includes(origrin)) {callback(null, true)}
        else{ 
            if (process.env.NODE_ENV === "production") {
               callback(null, true);
            } else {
                callback(new Error("Not allowed by CORS"));
            }
        }
    },
    credentials: true,
    methods: ["GET", "POST","PUT", "DELETE","PATCH","OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", x-Requested-With],
}))

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set("io", io);

app.get("/", (req, res) => {
    res.send("API is running");
});

app.use("/api/users", userRoutes);
// app.use("/api/sessions", sessionRoutes);

io.on("connection", (socket) => {
    console.log(`A user connected ${socket.id}`);
    const userId = socket.handshake.query.userId;
    if(userId) {
        socket.join(userId);
        console.log(`User ${socket.id} joined room ${userId}`);
    }
    socket.on("disconnect", () => {
        console.log(`A user disconnected ${socket.id}`);
    })    
})

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 8888;

server.listen(
    PORT,
    console.log(`Server running mode ${process.env.NODE_ENV} on port ${PORT}`)
); 