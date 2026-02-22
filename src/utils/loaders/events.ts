import type { Client } from 'discord.js';
import logger from '@/utils/logger';
import { getAllFiles } from './getAllFiles';

export const loadEvents = async (client: Client, dir: string) => {
  const eventFiles = getAllFiles(dir);
  let loadedCount = 0;

  for (const file of eventFiles) {
    const { event } = await import(file);

    if ('name' in event && 'execute' in event) {
      if (event.once) {
        client.once(event.name, (...args) => event.execute(...args));
      } else {
        client.on(event.name, (...args) => event.execute(...args));
      }

      loadedCount += 1;
    } else {
      logger.warn(`invalid event file: ${file}`);
    }
  }

  logger.info({ loadedCount }, 'Eventos cargados');
};
