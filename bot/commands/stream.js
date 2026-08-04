const { SlashCommandBuilder } = require('discord.js');
const { getOne, getAll } = require('../../shared/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stream')
    .setDescription('Show stream status for this server\'s team'),

  async execute(interaction, client) {
    try {
      const discordServer = await getOne(
        'SELECT * FROM discord_servers WHERE guild_id = ?',
        [interaction.guild.id]
      );

      if (!discordServer) {
        return interaction.reply({
          content: 'This Discord server is not connected to a Production team. Use `/setup` first.',
          ephemeral: true
        });
      }

      const connections = await getAll(
        'SELECT name, status FROM obs_connections WHERE team_id = ?',
        [discordServer.team_id]
      );

      const team = await getOne('SELECT name FROM teams WHERE id = ?', [discordServer.team_id]);

      const liveProductions = await getAll(
        `SELECT name, status FROM productions WHERE team_id = ? AND status = 'live'`,
        [discordServer.team_id]
      );

      const embed = {
        color: 0x4c6ef5,
        title: 'Stream Status',
        description: `Stream status for **${team ? team.name : 'Unknown'}**`,
        fields: [],
        footer: { text: 'Production Platform' },
        timestamp: new Date().toISOString()
      };

      // OBS connections
      if (connections.length === 0) {
        embed.fields.push({ name: 'OBS', value: 'No connections configured.', inline: true });
      } else {
        const connected = connections.filter(c => c.status === 'connected').length;
        embed.fields.push({
          name: 'OBS',
          value: `${connected}/${connections.length} connected`,
          inline: true
        });
      }

      // Active productions
      if (liveProductions.length === 0) {
        embed.fields.push({ name: 'Active Productions', value: 'None', inline: true });
      } else {
        embed.fields.push({
          name: 'Active Productions',
          value: liveProductions.map(p => p.name).join(', '),
          inline: true
        });
      }

      await interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Stream command error:', err);
      await interaction.reply({ content: 'An error occurred.', ephemeral: true });
    }
  }
};
