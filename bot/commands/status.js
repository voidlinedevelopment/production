const { SlashCommandBuilder } = require('discord.js');
const { getAll, getOne } = require('../../shared/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show OBS connection status for this server\'s team'),

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
        'SELECT name, host, port, status FROM obs_connections WHERE team_id = ?',
        [discordServer.team_id]
      );

      const team = await getOne('SELECT name FROM teams WHERE id = ?', [discordServer.team_id]);

      const embed = {
        color: 0x4c6ef5,
        title: 'OBS Status',
        description: `Status for team **${team ? team.name : 'Unknown'}**`,
        fields: [],
        footer: { text: 'Production Platform' },
        timestamp: new Date().toISOString()
      };

      if (connections.length === 0) {
        embed.fields.push({ name: 'Connections', value: 'No OBS connections configured.' });
      } else {
        connections.forEach(conn => {
          const statusEmoji = conn.status === 'connected' ? '🟢' : '🔴';
          embed.fields.push({
            name: conn.name,
            value: `${statusEmoji} ${conn.status}\n\`${conn.host}:${conn.port}\``,
            inline: true
          });
        });
      }

      await interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Status command error:', err);
      await interaction.reply({ content: 'An error occurred.', ephemeral: true });
    }
  }
};
