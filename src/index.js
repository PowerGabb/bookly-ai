import express from 'express';
import cors from 'cors';
import routes from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { setupSocketHandlers } from './socket/index.js';

const app = express();
const server = createServer(app);

// Middleware untuk menyimpan raw body sebelum parsing
app.use((req, res, next) => {
  if (req.originalUrl === '/api/payment/webhook') {
    next();
  } else {
    express.json()(req, res, next);
  }
});

app.use(cors());
app.use('/api', routes);
app.use(errorHandler);

const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL,
    methods: ["GET", "POST"]
  }
});

setupSocketHandlers(io);

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server is running on port ke ntar berapa ${PORT}`);
  console.log(`Socket.IO server is ready at ws://localhost:${PORT}`);
}); 