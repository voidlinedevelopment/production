const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getOne, getAll } = require('../../shared/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('production')
    .setDescription('Show active productions for this server\'s team'),

  async execute(interaction, client) {
    try {
      const discordServer = await getOne(
        'SELECT * FROM discord_servers WHERE guild_id = ?',
        [interaction.guild.id]
      );

      if (!discordServer) {
        return interaction.reply({
          content: 'This Discord server is not connected to a Production team. Use `/setup` first.',
          flags: MessageFlags.Ephemeral
        });
      }

      const productions = await getAll(
        `SELECT * FROM productions WHERE team_id = ? AND (status = 'live' OR status = 'upcoming')
         ORDER BY start_time ASC`,
        [discordServer.team_id]
      );

      const team = await getOne('SELECT name FROM teams WHERE id = ?', [discordServer.team_id]);

      const embed = {
        color: productions.some(p => p.status === 'live') ? 0xfa5252 : 0x4c6ef5,
        title: 'Productions',
        description: `Productions for **${team ? team.name : 'Unknown'}**`,
        fields: [],
        footer: { text: 'Production Platform' },
        timestamp: new Date().toISOString()
      };

      if (productions.length === 0) {
        embed.fields.push({ name: 'No Active Productions', value: 'There are no live or upcoming productions.' });
      } else {
        productions.forEach(prod => {
          const statusIcon = prod.status === 'live' ? '🔴 LIVE' : '📋 Draft';
          embed.fields.push({
            name: prod.name,
            value: `Status: ${statusIcon}\n${prod.description || 'No description'}\nStart: ${prod.start_time ? new Date(prod.start_time).toLocaleString() : 'Not set'}`,
            inline: false
          });
        });
      }

      await interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Production command error:', err);
      await interaction.reply({ content: 'An error occurred.', flags: MessageFlags.Ephemeral });
    }
  }
};
