import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import afeRoutes from './routes/afe.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// API key middleware
app.use((req, res, next) => {
  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${process.env.API_KEY}`) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
});

// Mount /afe routes
app.use('/afe', afeRoutes);

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Bridge API listening on http://localhost:${port}`);
});

