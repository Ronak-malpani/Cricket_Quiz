const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const fs = require('fs');

// Function to send the Post-Quiz Pack Reward Prompt
async function sendQuizRewards(interaction, winnerId) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`open_pack_${winnerId}`)
      .setLabel('🎁 Open Pack Now')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`save_pack_${winnerId}`)
      .setLabel('🎒 Save for Later')
      .setStyle(ButtonStyle.Secondary)
  );

  const embed = new EmbedBuilder()
    .setTitle('🏆 Quiz Match Complete!')
    .setDescription('Congratulations on winning the match! You have been awarded **1x Cricket Player Pack** and 50 Coins.')
    .setColor('#00FFCC');

  await interaction.reply({ embeds: [embed], components: [row] });
}

// Function to handle Pack Opening Button Click
async function handlePackButton(interaction) {
  if (!interaction.isButton()) return;
  
  const [action, type, userId] = interaction.customId.split('_');
  
  // Security check: ensure only the winning user can open their pack
  if (interaction.user.id !== userId) {
    return interaction.reply({ content: 'This pack does not belong to you!', ephemeral: true });
  }

  if (action === 'open') {
    // Import your dropCardReward function from earlier
    const { dropCardReward } = require('./economy.js');
    const unlockedCard = dropCardReward(userId);

    const cardEmbed = new EmbedBuilder()
      .setTitle('🎉 Pack Opened!')
      .setDescription(`You pulled a **[${unlockedCard.rarity}]** card!\n\n**${unlockedCard.name}**\n*Perk: ${unlockedCard.perk}*`)
      .setImage(unlockedCard.image)
      .setColor('#FFD700');

    await interaction.update({ embeds: [cardEmbed], components: [] });
  } else if (action === 'save') {
    // Add pack to inventory instead of opening
    let db = JSON.parse(fs.readFileSync('./user_inventory.json'));
    if (!db.users[userId].unopened_packs) db.users[userId].unopened_packs = 0;
    db.users[userId].unopened_packs += 1;
    fs.writeFileSync('./user_inventory.json', JSON.stringify(db, null, 2));

    await interaction.update({ content: '🎒 Pack saved safely to your inventory! Use `/inventory` to open it later.', embeds: [], components: [] });
  }
}

module.exports = { sendQuizRewards, handlePackButton };