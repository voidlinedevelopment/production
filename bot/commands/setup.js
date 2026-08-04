const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getOne, getAll, runQuery } = require('../../shared/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Connect this Discord server to a Production team')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(option =>
      option.setName('team_id')
        .setDescription('The ID of your Production team')
        .setRequired(true)
    ),

  async execute(interaction, client) {
    try {
      const teamId = interaction.options.getInteger('team_id');
      const guild = interaction.guild;

      const team = await getOne('SELECT * FROM teams WHERE id = ?', [teamId]);
      if (!team) {
        return interaction.reply({ content: 'Team not found. Please check the team ID.', ephemeral: true });
      }

      const existing = await getOne(
        'SELECT * FROM discord_servers WHERE guild_id = ?',
        [guild.id]
      );

      if (existing) {
        await runQuery(
          'UPDATE discord_servers SET team_id = ?, guild_name = ? WHERE guild_id = ?',
          [teamId, guild.name, guild.id]
        );
      } else {
        await runQuery(
          'INSERT INTO discord_servers (team_id, guild_id, guild_name, icon) VALUES (?, ?, ?, ?)',
          [teamId, guild.id, guild.name, guild.iconURL() || '']
        );
      }

      await runQuery(
        'INSERT INTO activity_logs (team_id, user_id, action) VALUES (?, ?, ?)',
        [teamId, interaction.user.id, `Discord server connected: ${guild.name}`]
      );

      const embed = {
        color: 0x4c6ef5,
        title: 'Production - Server Connected',
        description: `This Discord server has been connected to team **${team.name}**.`,
        fields: [
          { name: 'Team', value: team.name, inline: true },
          { name: 'Server', value: guild.name, inline: true },
          { name: 'Team ID', value: String(teamId), inline: true }
        ],
        footer: { text: 'Production Platform' },
        timestamp: new Date().toISOString()
      };

      await interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Setup command error:', err);
      await interaction.reply({ content: 'An error occurred during setup.', ephemeral: true });
    }
  }
};
