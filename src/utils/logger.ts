import pino from 'pino';
import config from '@/utils/config';

const logger = pino({
  level: config.showDebug ? 'debug' : 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:dd-mm-yyyy HH:MM:ss',
      ignore: 'pid,hostname',
    },
  },
  serializers: {
    err: (err) => ({
      stack: err.stack,
    }),
  },
});

export default logger;
