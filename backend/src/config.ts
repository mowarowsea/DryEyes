import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  changedetection: {
    baseUrl: process.env.CHANGEDETECTION_URL || 'http://localhost:5000',
    apiKey: process.env.CHANGEDETECTION_API_KEY || '',
  },
  ntfy: {
    baseUrl: process.env.NTFY_URL || 'http://localhost:8085',
    defaultTopic: process.env.NTFY_DEFAULT_TOPIC || 'dryeyes',
  },
};
