require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { Client, GatewayIntentBits, Collection } = require('discord.js');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { getDatabase, initializeDatabase, getAll, getOne, runQuery } = require('../shared/database');

const PORT = process.env.BOT_PORT || 4000;

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.commands = new Collection();
client.config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID,
  websiteUrl: process.env.WEBSITE_URL || 'http://localhost:3000'
};

// Load commands
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
  const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
  for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    if (command.data && command.execute) {
      client.commands.set(command.data.name, command);
      console.log(`Loaded command: ${command.data.name}`);
    }
  }
}

// Load events
const eventsPath = path.join(__dirname, 'events');
if (fs.existsSync(eventsPath)) {
  const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
  for (const file of eventFiles) {
    const event = require(path.join(eventsPath, file));
    if (event.name && event.execute) {
      if (event.once) {
        client.once(event.name, (...args) => event.execute(...args, client));
      } else {
        client.on(event.name, (...args) => event.execute(...args, client));
      }
      console.log(`Loaded event: ${event.name}`);
    }
  }
}

// Bot events
client.once('ready', () => {
  console.log(`Production Bot is online as ${client.user.tag}`);
  client.user.setActivity('Productions | /help', { type: 2 });
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction, client);
  } catch (error) {
    console.error(`Error executing ${interaction.commandName}:`, error);
    const reply = { content: 'An error occurred while executing this command.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
});

// Simple HTTP API for website communication
const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET' && req.url === '/api/status') {
    return res.end(JSON.stringify({
      online: client.isReady(),
      guilds: client.guilds.cache.size,
      uptime: client.uptime
    }));
  }

  if (req.method === 'POST' && req.url === '/api/notify') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const { guildId, channelName, message } = data;

        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
          return res.end(JSON.stringify({ success: false, error: 'Guild not found' }));
        }

        const channel = guild.channels.cache.find(c =>
          c.name === channelName || c.id === channelName
        );

        if (!channel) {
          return res.end(JSON.stringify({ success: false, error: 'Channel not found' }));
        }

        await channel.send(message || 'Notification from Production');
        return res.end(JSON.stringify({ success: true }));
      } catch (err) {
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`Production Bot API running on port ${PORT}`);
});

// Initialize database and login
initializeDatabase().then(() => {
  console.log('Database initialized for bot.');
  client.login(client.config.token).catch(err => {
    console.error('Failed to login:', err.message);
    console.log('Bot will run in API-only mode. Set DISCORD_TOKEN in .env to enable the bot.');
  });
}).catch(err => {
  console.error('Database initialization failed:', err);
});
