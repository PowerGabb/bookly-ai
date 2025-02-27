import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import router from "./src/routes/index.js";
import { createServer } from 'http';
import setupCustomerSupportSocket from "./src/socket/customerSupport.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);

// Inisialisasi Socket.IO dengan path yang sama
const io = setupCustomerSupportSocket(server);

// Tambahkan ini untuk debugging socket connections
io.on('connection', (socket) => {
  console.log('New socket connection established');
});

app.use(express.json());
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.urlencoded({ extended: true }));

// Serve static files from uploads directory
app.use('/uploads', express.static(path.join(__dirname, '/uploads')));

app.get('/', (req, res) => {
    res.send('Welcome To Bookly API Developers');
});
app.use("/api", router);

const PORT = process.env.PORT || 3000;
// Ubah app.listen menjadi server.listen
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Socket.IO server is ready at ws://localhost:${PORT}`);
});

