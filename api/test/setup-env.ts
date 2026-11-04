import { config } from 'dotenv';

config();

const configured =
  process.env.DATABASE_URL ??
  'postgresql://ticketing:ticketing@localhost:5432/ticketing';

process.env.DATABASE_URL = configured.replace(/\/[^/]+$/, '/ticketing_test');
process.env.JWT_SECRET = 'test-secret';
process.env.WEB_ORIGIN = 'http://localhost:3000';
process.env.PORT = '3001';
