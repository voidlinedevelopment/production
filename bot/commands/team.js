const { SlashCommandBuilder } = require('discord.js');
const { getOne, getAll } = require('../../shared/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('team')
    .setDescription('Show team members for this server\'s team'),

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

      const members = await getAll(
        `SELECT tm.*, u.username, u.global_name, r.name as role_name
         FROM team_members tm
         INNER JOIN users u ON u.id = tm.user_id
         LEFT JOIN roles r ON r.id = tm.role_id
         WHERE tm.team_id = ?`,
        [discordServer.team_id]
      );

      const team = await getOne('SELECT name FROM teams WHERE id = ?', [discordServer.team_id]);

      const embed = {
        color: 0x4c6ef5,
        title: 'Team Members',
        description: `Members of **${team ? team.name : 'Unknown'}**`,
        fields: [],
        footer: { text: 'Production Platform' },
        timestamp: new Date().toISOString()
      };

      if (members.length === 0) {
        embed.fields.push({ name: 'No Members', value: 'This team has no members.' });
      } else {
        const memberList = members.map(m =>
          `**${m.global_name || m.username}** - ${m.role_name || 'No Role'}`
        ).join('\n');
        embed.fields.push({ name: `Members (${members.length})`, value: memberList });
      }

      await interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Team command error:', err);
      await interaction.reply({ content: 'An error occurred.', ephemeral: true });
    }
  }
};
