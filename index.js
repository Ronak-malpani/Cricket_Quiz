require('dotenv').config();
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { getCricketQuestions } = require('./fetchQuestions');
const fs = require('fs');

// Add this at the bottom of your index.js file
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Cricket Quiz Bot is alive!');
});

app.listen(PORT, () => {
  console.log(`Web server is running on port ${PORT}`);
});

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

const SCORES_FILE = './scores.json';

function loadScores() {
    try {
        if (fs.existsSync(SCORES_FILE)) return JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8'));
    } catch (e) { console.error(e); }
    return { global: {}, guilds: {} };
}

function saveScores(scores) {
    try { fs.writeFileSync(SCORES_FILE, JSON.stringify(scores, null, 2)); } catch (e) { console.error(e); }
}

const commands = [
    new SlashCommandBuilder()
        .setName('quiz')
        .setDescription('Start a multiplayer cricket trivia match lobby!')
        .addIntegerOption(option =>
            option.setName('length')
                .setDescription('Number of questions in this session')
                .setRequired(true)
                .addChoices(
                    { name: '5 Questions', value: 5 },
                    { name: '10 Questions', value: 10 }
                )
        ),
    new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('View this server\'s top cricket experts leaderboard!'),
    new SlashCommandBuilder()
        .setName('global-leaderboard')
        .setDescription('View the worldwide top cricket experts leaderboard!')
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('ready', async () => {
    console.log(`Bot logged in as ${client.user.tag}`);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Successfully registered global application slash commands.');
    } catch (error) {
        console.error(error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, guildId } = interaction;

    if (commandName === 'quiz') {
        // 1. Immediately defer reply to prevent Discord 3-second timeout error
        await interaction.deferReply();

        const totalQuestions = interaction.options.getInteger('length');
        const hostId = interaction.user.id;
        const joinedPlayers = new Map();

        // Automatically include the host in the lobby
        joinedPlayers.set(hostId, { username: interaction.user.username, score: 0, streak: 0 });

        // 2. Send Lobby Message with Join Button via editReply
        const joinRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('join_lobby')
                .setLabel('Join Quiz Lobby 🏏')
                .setStyle(ButtonStyle.Success)
        );

        let lobbyTimeLeft = 15;
        const lobbyEmbed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle('🏏 Pure Cricket Match Lobby')
            .setDescription(`Hosted by **${interaction.user.username}**\n\n**Players Joined (${joinedPlayers.size}):**\n` + 
                Array.from(joinedPlayers.values()).map(p => `• ${p.username}`).join('\n') +
                `\n\n⏱️ Match starts in **${lobbyTimeLeft}s**. Click below to join!`)
            .setFooter({ text: 'Get ready for synchronized questions!' });

        await interaction.editReply({ embeds: [lobbyEmbed], components: [joinRow] });
        const lobbyMessage = await interaction.fetchReply();

        // Lobby Collector for joining
        const lobbyCollector = lobbyMessage.createMessageComponentCollector({ time: 15000 });

        lobbyCollector.on('collect', async i => {
            if (i.customId === 'join_lobby') {
                if (!joinedPlayers.has(i.user.id)) {
                    joinedPlayers.set(i.user.id, { username: i.user.username, score: 0, streak: 0 });
                    await i.reply({ content: "✅ You have successfully joined the quiz lobby!", ephemeral: true });
                } else {
                    await i.reply({ content: "⚠️ You are already in the lobby!", ephemeral: true });
                }

                const updatedDesc = `Hosted by **${interaction.user.username}**\n\n**Players Joined (${joinedPlayers.size}):**\n` + 
                    Array.from(joinedPlayers.values()).map(p => `• ${p.username}`).join('\n') +
                    `\n\n⏱️ Match starts in **${lobbyTimeLeft}s**. Click below to join!`;
                
                lobbyEmbed.setDescription(updatedDesc);
                await lobbyMessage.edit({ embeds: [lobbyEmbed] }).catch(() => {});
            }
        });

        // Countdown timer during lobby phase
        for (let t = 14; t >= 1; t--) {
            await new Promise(r => setTimeout(r, 1000));
            lobbyTimeLeft = t;
            const updatedDesc = `Hosted by **${interaction.user.username}**\n\n**Players Joined (${joinedPlayers.size}):**\n` + 
                Array.from(joinedPlayers.values()).map(p => `• ${p.username}`).join('\n') +
                `\n\n⏱️ Match starts in **${lobbyTimeLeft}s**. Click below to join!`;
            lobbyEmbed.setDescription(updatedDesc);
            await lobbyMessage.edit({ embeds: [lobbyEmbed] }).catch(() => {});
        }

        lobbyCollector.stop();

        // Disable lobby join button & fetch questions while lobby finishes
        const disabledJoinRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('join_lobby')
                .setLabel('Lobby Closed 🔒')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true)
        );
        await lobbyMessage.edit({ content: "🚨 **Lobby closed! Fetching synchronized questions...**", components: [disabledJoinRow] }).catch(() => {});

        // Fetch synchronized question set for all players
        const questions = await getCricketQuestions(totalQuestions);

        // 3. Loop through questions where everyone answers concurrently
        for (let qIndex = 0; qIndex < questions.length; qIndex++) {
            const q = questions[qIndex];

            const row = new ActionRowBuilder();
            q.options.forEach((option, index) => {
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`q_${qIndex}_${index}`)
                        .setLabel(`${String.fromCharCode(65 + index)}: ${option.substring(0, 65)}`)
                        .setStyle(ButtonStyle.Primary)
                );
            });

            let qTimeLeft = 15;
            const qEmbed = new EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle(`🏏 Question ${qIndex + 1} of ${totalQuestions} (Multiplayer Match)`)
                .setDescription(q.question)
                .setFooter({ text: `⏱️ Time remaining: ${qTimeLeft}s | Players active: ${joinedPlayers.size}` });

            const questionMessage = await interaction.channel.send({ embeds: [qEmbed], components: [row] });

            const qInterval = setInterval(async () => {
                if (qTimeLeft <= 1) {
                    clearInterval(qInterval);
                    return;
                }
                qTimeLeft -= 1;
                qEmbed.setFooter({ text: `⏱️ Time remaining: ${qTimeLeft}s | Players active: ${joinedPlayers.size}` });
                await questionMessage.edit({ embeds: [qEmbed] }).catch(() => {});
            }, 1000);

            const answeredUsers = new Set();
            const roundCollector = questionMessage.createMessageComponentCollector({ time: 15000 });

            roundCollector.on('collect', async i => {
                if (!joinedPlayers.has(i.user.id)) {
                    return i.reply({ content: "❌ You did not join this match lobby! Wait for the next round.", ephemeral: true });
                }

                if (answeredUsers.has(i.user.id)) {
                    return i.reply({ content: "⚠️ You already answered this question!", ephemeral: true });
                }

                answeredUsers.add(i.user.id);
                const selectedIndex = parseInt(i.customId.split('_')[2]);
                const player = joinedPlayers.get(i.user.id);

                if (selectedIndex === q.answer) {
                    player.streak += 1;
                    let earned = 1;
                    let streakMsg = "";
                    if (player.streak >= 3) {
                        earned += 2;
                        streakMsg = ` 🔥 (${player.streak}x Streak! +2 Pts)`;
                    }

                    player.score += earned;

                    const scores = loadScores();
                    if (!scores.global) scores.global = {};
                    if (!scores.guilds) scores.guilds = {};
                    if (!scores.guilds[guildId]) scores.guilds[guildId] = {};
                    if (!scores.global[i.user.id]) scores.global[i.user.id] = { username: i.user.username, points: 0 };
                    if (!scores.guilds[guildId][i.user.id]) scores.guilds[guildId][i.user.id] = { username: i.user.username, points: 0 };

                    scores.global[i.user.id].points += earned;
                    scores.guilds[guildId][i.user.id].points += earned;
                    saveScores(scores);

                    await i.reply({ content: `🎉 Correct! (+${earned} pts).${streakMsg}`, ephemeral: true });
                } else {
                    player.streak = 0;
                    await i.reply({ content: `❌ Incorrect! The correct answer was **${q.options[q.answer]}**. Streak reset.`, ephemeral: true });
                }
            });

            await new Promise(resolve => {
                roundCollector.on('end', async () => {
                    clearInterval(qInterval);

                    const disabledQRow = new ActionRowBuilder();
                    q.options.forEach((option, index) => {
                        let style = ButtonStyle.Secondary;
                        if (index === q.answer) style = ButtonStyle.Success;
                        disabledQRow.addComponents(
                            new ButtonBuilder()
                                .setCustomId(`dis_${index}`)
                                .setLabel(`${String.fromCharCode(65 + index)}: ${option.substring(0, 65)}`)
                                .setStyle(style)
                                .setDisabled(true)
                        );
                    });

                    await questionMessage.edit({
                        content: `🔒 **Time's up for Question ${qIndex + 1}!** Correct Answer: **${q.options[q.answer]}**`,
                        components: [disabledQRow]
                    }).catch(() => {});

                    setTimeout(resolve, 2000);
                });
            });
        }

        // 4. Match Summary Leaderboard
        const sortedMatchPlayers = Array.from(joinedPlayers.values()).sort((a, b) => b.score - a.score);
        let summaryDesc = sortedMatchPlayers.map((p, idx) => {
            const medal = idx === 0 ? '🏆' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;
            return `${medal} **${p.username}** — **${p.score} points**`;
        }).join('\n');

        const summaryEmbed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle('🏁 Multiplayer Match Complete!')
            .setDescription(`Here are the final standings for this session:\n\n${summaryDesc}`)
            .setFooter({ text: 'Check overall standings using /leaderboard or /global-leaderboard' });

        await interaction.channel.send({ embeds: [summaryEmbed] });
    }

    if (commandName === 'leaderboard') {
        const scores = loadScores();
        const guildScores = scores.guilds?.[guildId] || {};
        
        const sortedUsers = Object.entries(guildScores)
            .sort((a, b) => b[1].points - a[1].points)
            .slice(0, 10);

        if (sortedUsers.length === 0) {
            return interaction.reply({ content: "🏆 No scores recorded in this server yet! Run `/quiz` to start playing.", ephemeral: true });
        }

        let description = sortedUsers.map(([id, data], index) => {
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`;
            return `${medal} **${data.username}** — **${data.points} pts**`;
        }).join('\n');

        const lbEmbed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle('🏆 Server Cricket Leaderboard')
            .setDescription(description)
            .setFooter({ text: 'Play /quiz to climb this server\'s ranks!' });

        await interaction.reply({ embeds: [lbEmbed] });
    }

    if (commandName === 'global-leaderboard') {
        const scores = loadScores();
        const globalScores = scores.global || {};
        
        const sortedUsers = Object.entries(globalScores)
            .sort((a, b) => b[1].points - a[1].points)
            .slice(0, 10);

        if (sortedUsers.length === 0) {
            return interaction.reply({ content: "🏆 No global scores recorded yet! Run `/quiz` to start playing.", ephemeral: true });
        }

        let description = sortedUsers.map(([id, data], index) => {
            const medal = index === 0 ? '🌍🥇' : index === 1 ? '🌍🥈' : index === 2 ? '🌍🥉' : `#${index + 1}`;
            return `${medal} **${data.username}** — **${data.points} pts**`;
        }).join('\n');

        const globalEmbed = new EmbedBuilder()
            .setColor(0x00FF66)
            .setTitle('🌍 Worldwide Cricket Leaderboard')
            .setDescription(description)
            .setFooter({ text: 'Top players across all Discord servers!' });

        await interaction.reply({ embeds: [globalEmbed] });
    }
});

client.login(process.env.DISCORD_TOKEN);