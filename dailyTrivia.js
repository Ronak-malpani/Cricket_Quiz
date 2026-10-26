const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { getCricketQuestions } = require('./fetchQuestions');
const fs = require('fs');

const INVENTORY_FILE = './user_inventory.json';
const activeQotdQuestions = new Map(); // messageId -> question object

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

        const roleId = process.env.QOTD_ROLE_ID;
        const rolePingMention = (roleId && roleId.trim() !== '' && roleId !== 'undefined') ? `<@&${roleId}>` : '@everyone';

        // Post all 3 questions one by one
        for (let i = 0; i < questions.length; i++) {
            const q = questions[i];
            const qNum = i + 1;

            if (specificChannel) {
                await postAndRunQuestion(specificChannel, q, rolePingMention, qNum);
            } else {
                for (const guild of client.guilds.cache.values()) {
                    try {
                        const targetChannel = guild.systemChannel || guild.channels.cache.find(c => c.isTextBased() && c.permissionsFor(guild.members.me)?.has('SendMessages'));
                        if (!targetChannel) continue;

                        postAndRunQuestion(targetChannel, q, rolePingMention, qNum);
                    } catch (guildErr) {
                        console.error(`Failed to send automated QOTD in guild ${guild.name}:`, guildErr);
                    }
                }
                // Wait 30 seconds before posting the next automated question
                await new Promise(r => setTimeout(r, 30000));
            }
        }
    } catch (err) {
        console.error('Error executing automated QOTD:', err);
    }
}

async function postAndRunQuestion(channel, q, rolePingMention, qNum) {
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
        .setTitle(`⭐ Scheduled Daily Cricket Trivia Challenge (Question ${qNum}/3)`)
        .setDescription(q.question + `\n\n*⏱️ Time remaining: **${timeLeft}s** to answer!* \n*📝 Note: Answer correctly to win **+50 Cricket Avengers Coins**!*`)
        .setFooter({ text: 'Automated daily community challenge' });

    const qotdMsg = await channel.send({ 
        content: `${rolePingMention} 🚨 **New Daily QOTD Challenge (Q${qNum}/3) is Live!**`, 
        embeds: [qotdEmbed], 
        components: [row], 
        allowedMentions: { parse: ['everyone', 'roles'] } 
    });

    activeQotdQuestions.set(qotdMsg.id, q);

    return new Promise((resolve) => {
        const timerInterval = setInterval(async () => {
            timeLeft -= 1;
            if (timeLeft >= 0) {
                qotdEmbed.setDescription(q.question + `\n\n*⏱️ Time remaining: **${timeLeft}s** to answer!* \n*📝 Note: Answer correctly to win **+50 Cricket Avengers Coins**!*`);
                await qotdMsg.edit({ embeds: [qotdEmbed] }).catch(() => {});
            } else {
                clearInterval(timerInterval);
            }
        }, 1000);

        const qotdCollector = qotdMsg.createMessageComponentCollector({ time: 30000 });
        qotdCollector.on('end', async () => {
            clearInterval(timerInterval);
            activeQotdQuestions.delete(qotdMsg.id);

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
            await qotdMsg.edit({ content: `🔒 **Question ${qNum}/3 Closed!** Correct Answer was: **${q.options[q.answer]}**`, components: [disabledRow] }).catch(() => {});
            resolve();
        });
    });
}

const answeredTriviaMap = new Map();

function handleDailyTriviaInteraction(interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith('qotd_auto_')) return false;

    const userId = interaction.user.id;
    const messageId = interaction.message.id;

    if (!answeredTriviaMap.has(messageId)) {
        answeredTriviaMap.set(messageId, new Set());
    }

    if (answeredTriviaMap.get(messageId).has(userId)) {
        interaction.reply({ content: '⚠️ You have already answered this question!', flags: 64 }).catch(() => {});
        return true;
    }

    const parts = interaction.customId.split('_');
    const selectedOpt = parseInt(parts[2]);
    const correctOpt = parseInt(parts[3]);

    let invDb = { users: {} };
    if (fs.existsSync(INVENTORY_FILE)) {
        invDb = JSON.parse(fs.readFileSync(INVENTORY_FILE, 'utf8'));
    }
    if (!invDb.users[userId]) {
        invDb.users[userId] = { coins: 0, inventory: [], unopened_packs: 0 };
    }

    answeredTriviaMap.get(messageId).add(userId);

    const currentQuestion = activeQotdQuestions.get(messageId);
    const correctText = currentQuestion ? currentQuestion.options[correctOpt] : "the correct option";

    if (selectedOpt === correctOpt) {
        invDb.users[userId].coins += 50; 
        fs.writeFileSync(INVENTORY_FILE, JSON.stringify(invDb, null, 2));
        interaction.reply({ content: '🎉 **Correct Answer!** You earned **+50 Cricket Avengers Coins**! Check your `/inventory`.', flags: 64 }).catch(() => {});
    } else {
        interaction.reply({ content: `❌ **Incorrect Answer!** The correct answer was **${correctText}**. Better luck on the next question.`, flags: 64 }).catch(() => {});
    }
    return true;
}

module.exports = { startDailyTriviaScheduler, handleDailyTriviaInteraction, triggerAutomatedQotd };