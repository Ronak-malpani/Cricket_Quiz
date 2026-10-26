const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { getCricketQuestions } = require('./fetchQuestions');
const fs = require('fs');

const INVENTORY_FILE = './user_inventory.json';

function startDailyTriviaScheduler(client) {
    setInterval(() => {
        const now = new Date();
        const utcHours = now.getUTCHours();
        const utcMinutes = now.getUTCMinutes();
        const istMinutesTotal = utcHours * 60 + utcMinutes + 330;
        const istHours = Math.floor(istMinutesTotal / 60) % 24;
        const istMinutes = istMinutesTotal % 60;

        const targetTimes = [
            { hour: 8, minute: 0 },
            { hour: 13, minute: 0 },
            { hour: 18, minute: 0 },
            { hour: 21, minute: 0 }
        ];

        for (const t of targetTimes) {
            if (istHours === t.hour && istMinutes === t.minute) {
                console.log(`Triggering scheduled Daily Trivia for IST ${t.hour}:${t.minute}`);
                triggerAutomatedQotd(client);
                break;
            }
        }
    }, 60000);
}

async function triggerAutomatedQotd(client, specificChannel = null) {
    try {
        const questions = await getCricketQuestions(3);
        if (!questions || questions.length === 0) return;
        const q = questions[0];

        const row = new ActionRowBuilder();
        q.options.forEach((option, index) => {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`qotd_auto_${index}_${q.answer}`)
                    .setLabel(`${String.fromCharCode(65 + index)}: ${option.substring(0, 65)}`)
                    .setStyle(ButtonStyle.Primary)
            );
        });

        let timeLeft = 30;
        const qotdEmbed = new EmbedBuilder()
            .setColor(0xFF5733)
            .setTitle('⭐ Scheduled Daily Cricket Trivia Challenge')
            .setDescription(q.question + `\n\n*⏱️ Time remaining: **${timeLeft}s** to answer!* \n*📝 Note: You have **30 seconds** to answer! Answer correctly to win **+50 Cricket Avengers Coins**!*`)
            .setFooter({ text: 'Automated daily community challenge' });

        const roleId = process.env.QOTD_ROLE_ID;
        const rolePingMention = (roleId && roleId.trim() !== '' && roleId !== 'undefined') ? `<@&${roleId}>` : '@everyone';

        if (specificChannel) {
            const qotdMsg = await specificChannel.send({ 
                content: `${rolePingMention} 🚨 **New Daily QOTD Challenge is Live!**`, 
                embeds: [qotdEmbed], 
                components: [row], 
                allowedMentions: { parse: ['everyone', 'roles'] } 
            });
            startTimerAndCollector(qotdMsg, q, timeLeft, qotdEmbed);
            return;
        }

        for (const guild of client.guilds.cache.values()) {
            try {
                const targetChannel = guild.systemChannel || guild.channels.cache.find(c => c.isTextBased() && c.permissionsFor(guild.members.me)?.has('SendMessages'));
                if (!targetChannel) continue;

                const qotdMsg = await targetChannel.send({ 
                    content: `${rolePingMention} 🚨 **New Scheduled Daily Trivia is Live!**`, 
                    embeds: [qotdEmbed], 
                    components: [row], 
                    allowedMentions: { parse: ['everyone', 'roles'] } 
                });
                startTimerAndCollector(qotdMsg, q, timeLeft, qotdEmbed);
            } catch (guildErr) {
                console.error(`Failed to send automated QOTD in guild ${guild.name}:`, guildErr);
            }
        }
    } catch (err) {
        console.error('Error executing automated QOTD:', err);
    }
}

function startTimerAndCollector(qotdMsg, q, timeLeft, qotdEmbed) {
    const timerInterval = setInterval(async () => {
        timeLeft -= 1;
        if (timeLeft >= 0) {
            qotdEmbed.setDescription(q.question + `\n\n*⏱️ Time remaining: **${timeLeft}s** to answer!* \n*📝 Note: You have **30 seconds** to answer! Answer correctly to win **+50 Cricket Avengers Coins**!*`);
            await qotdMsg.edit({ embeds: [qotdEmbed] }).catch(() => {});
        } else {
            clearInterval(timerInterval);
        }
    }, 1000);

    const qotdCollector = qotdMsg.createMessageComponentCollector({ time: 30000 });
    qotdCollector.on('end', async () => {
        clearInterval(timerInterval);
        const disabledRow = new ActionRowBuilder();
        q.options.forEach((option, index) => {
            let style = ButtonStyle.Secondary;
            if (index === q.answer) style = ButtonStyle.Success;
            disabledRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`qotd_dis_${index}`)
                    .setLabel(`${String.fromCharCode(65 + index)}: ${option.substring(0, 65)}`)
                    .setStyle(style)
                    .setDisabled(true)
            );
        });
        await qotdMsg.edit({ content: '🔒 **Trivia Closed!** Time is up for this question.', components: [disabledRow] }).catch(() => {});
    });
}

// Track answered users per specific message ID so future trivia works normally
const answeredTriviaMap = new Map();

function handleDailyTriviaInteraction(interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith('qotd_auto_')) return false;

    const userId = interaction.user.id;
    const messageId = interaction.message.id;

    if (!answeredTriviaMap.has(messageId)) {
        answeredTriviaMap.set(messageId, new Set());
    }

    if (answeredTriviaMap.get(messageId).has(userId)) {
        interaction.reply({ content: '⚠️ You have already answered this trivia question!', flags: 64 }).catch(() => {});
        return true;
    }

    const parts = interaction.customId.split('_');
    const selectedOpt = parts[2];
    const correctOpt = parts[3];

    let invDb = { users: {} };
    if (fs.existsSync(INVENTORY_FILE)) {
        invDb = JSON.parse(fs.readFileSync(INVENTORY_FILE, 'utf8'));
    }
    if (!invDb.users[userId]) {
        invDb.users[userId] = { coins: 0, inventory: [], unopened_packs: 0 };
    }

    const selectedIndex = parseInt(selectedOpt);
    const correctIndex = parseInt(correctOpt);

    answeredTriviaMap.get(messageId).add(userId);

    if (selectedIndex === correctIndex) {
        invDb.users[userId].coins += 50; 
        fs.writeFileSync(INVENTORY_FILE, JSON.stringify(invDb, null, 2));
        interaction.reply({ content: '🎉 **Correct Answer!** You earned **+50 Cricket Avengers Coins**! Check your `/inventory`.', flags: 64 }).catch(() => {});
    } else {
        interaction.reply({ content: '❌ **Incorrect Answer!** Better luck on the next trivia question.', flags: 64 }).catch(() => {});
    }
    return true;
}

module.exports = { startDailyTriviaScheduler, handleDailyTriviaInteraction, triggerAutomatedQotd };