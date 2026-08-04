module.exports = {
  name: 'ready',
  once: true,
  execute(client) {
    console.log(`Bot ready. Serving ${client.guilds.cache.size} guilds.`);
  }
};
