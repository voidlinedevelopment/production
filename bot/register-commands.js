require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command.data) {
    commands.push(command.data.toJSON());
  }
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`Registering ${commands.length} commands...`);

    await rest.put(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
      { body: commands }
    );

    console.log('Commands registered successfully!');
  } catch (error) {
    console.error('Error registering commands:', error);
  }
})();
