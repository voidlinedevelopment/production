module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    if (!interaction.isChatInputCommand()) return;
    // Handled in bot/index.js
  }
};
