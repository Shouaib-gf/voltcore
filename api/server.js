require('dotenv').config();               // ← add this line
const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const morgan   = require('morgan');
const vmRoutes = require('./routes/vms');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(morgan('combined'));

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date() }));
app.use('/api/vms', vmRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: err.message }); });

app.listen(PORT, '0.0.0.0', () => console.log(`VoltCore API running on port ${PORT}`));
