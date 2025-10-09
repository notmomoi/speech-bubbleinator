import path from 'node:path';
import { REST, Routes } from 'discord.js';
import config from '@/utils/config';
import logger from '../logger';
import { getAllFiles } from './getAllFiles';

logger.info('Starting command deployment script...');

if (!config.token) {
  throw new Error('Missing required env variable: DISCORD_TOKEN');
}
if (!config.clientId) {
  throw new Error('Missing required env variable: CLIENT_ID');
}

const commands = [];
const commandsPath = path.join(__dirname, '../..', 'commands');
const commandFiles = getAllFiles(commandsPath);

for (const filePath of commandFiles) {
  const { command } = await import(filePath);
  if (command && 'data' in command) {
    commands.push(command.data.toJSON());
  } else {
    logger.warn(
      `The command at ${filePath} is missing a required "data" property.`,
    );
  }
}

if (commands.length === 0) {
  logger.info('No commands found to deploy. Exiting.');
  process.exit(0);
}

const rest = new REST().setToken(config.token);

const isGlobalDeploy = process.argv.includes('--global');

(async () => {
  try {
    logger.info(
      `Started refreshing ${commands.length} application (/) commands.`,
    );

    if (isGlobalDeploy) {
      logger.info('Deploying commands globally...');
      await rest.put(Routes.applicationCommands(config.clientId), {
        body: commands,
      });
      logger.info(
        'Successfully deployed commands globally. It may take up to an hour to see changes.',
      );
    } else {
      if (!config.guildId) {
        throw new Error(
          'Missing GUILD_ID env variable for guild-based deployment. Add it to .env and config.ts or use the --global flag.',
        );
      }

      const guildIds = config.guildId.split(',').map((id) => id.trim());

      logger.info(
        `Deploying commands to ${guildIds.length} specified guilds...`,
      );

      for (const guildId of guildIds) {
        await rest.put(
          Routes.applicationGuildCommands(config.clientId, guildId),
          {
            body: commands,
          },
        );
        logger.info(`Successfully reloaded commands for guild: ${guildId}`);
      }
    }
  } catch (error) {
    logger.error(`Error deploying commands: ${error}`);
  }
})();
