require('dotenv').config();
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { getCricketQuestions } = require('./fetchQuestions');
const { dropCardReward } = require('./economy.js');
const { startDailyTriviaScheduler, triggerAutomatedQotd, handleDailyTriviaInteraction } = require('./dailyTrivia');
const fs = require('fs');

// Express server setup for 24/7 uptime
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
const INVENTORY_FILE = './user_inventory.json';

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
        .setName('inventory')
        .setDescription('View your cards, coins, unopened packs, and open saved packs!'),
    new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('View this server\'s top cricket experts leaderboard!'),
    new SlashCommandBuilder()
        .setName('global-leaderboard')
        .setDescription('View the worldwide top cricket experts leaderboard!'),
    new SlashCommandBuilder()
        .setName('qotd')
        .setDescription('Trigger today\'s Cricket Question of the Day with a role ping and 30s timer!')
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('clientReady', async () => {
    console.log(`Bot logged in as ${client.user.tag}`);
    if (!global.triviaSchedulerStarted) {
        global.triviaSchedulerStarted = true;
        startDailyTriviaScheduler(client);
        console.log('Daily Trivia Scheduler started successfully.');
    }

    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Successfully registered global application slash commands.');
    } catch (error) {
        console.error(error);
    }
});

client.on('interactionCreate', async interaction => {
    if (interaction.isButton() && handleDailyTriviaInteraction(interaction)) return;

    // 1. Handle Button Interactions Separately
    if (interaction.isButton()) {
        const customId = interaction.customId;

        // Ignore lobby, disabled buttons, match quiz answers, and automated QOTD buttons
        if (
            customId === 'join_lobby' || 
            customId === 'leave_lobby' || 
            customId === 'start_now' || 
            customId === 'cancel_match' || 
            customId === 'transfer_host' || 
            customId.startsWith('q_') || 
            customId.startsWith('dis_') ||
            customId.startsWith('qotd_auto_')
        ) {
            return; 
        }

        // Handle manual QOTD button answers
        if (customId.startsWith('qotd_')) {
            const [, qIdx, selectedOpt, correctOpt, authorId] = customId.split('_');
            const userId = interaction.user.id;

            let invDb = { users: {} };
            if (fs.existsSync(INVENTORY_FILE)) {
                invDb = JSON.parse(fs.readFileSync(INVENTORY_FILE, 'utf8'));
            }
            if (!invDb.users[userId]) {
                invDb.users[userId] = { coins: 0, inventory: [], unopened_packs: 0 };
            }

            const selectedIndex = parseInt(selectedOpt);
            const correctIndex = parseInt(correctOpt);

            if (selectedIndex === correctIndex) {
                invDb.users[userId].coins += 50; 
                fs.writeFileSync(INVENTORY_FILE, JSON.stringify(invDb, null, 2));
                return interaction.reply({ content: '🎉 **Correct (+1 Correct / 0 Incorrect)!** You earned **+50 Cricket Avengers Coins**! Check your `/inventory`.', flags: 64 }).catch(() => {});
            } else {
                return interaction.reply({ content: '❌ **Incorrect (0 Correct / +1 Incorrect)!** Better luck on the next QOTD question.', flags: 64 }).catch(() => {});
            }
        }

        if (!customId.startsWith('invopen_pack_')) {
            return;
        }

        const parts = customId.split('_');
        const action = parts[0]; 
        const targetUserId = parts[parts.length - 1]; 

        if (interaction.user.id !== targetUserId) {
            return interaction.reply({ content: '❌ This inventory does not belong to you!', flags: 64 }).catch(() => {});
        }

        if (action === 'invopen') {
            let db = { users: {} };
            if (fs.existsSync(INVENTORY_FILE)) {
                db = JSON.parse(fs.readFileSync(INVENTORY_FILE, 'utf8'));
            }
            if (!db.users[targetUserId] || db.users[targetUserId].unopened_packs <= 0) {
                return interaction.reply({ content: '❌ You have no unopened packs left!', flags: 64 }).catch(() => {});
            }
            db.users[targetUserId].unopened_packs -= 1;
            fs.writeFileSync(INVENTORY_FILE, JSON.stringify(db, null, 2));

            const unlockedCard = dropCardReward(targetUserId);

            const cardEmbed = new EmbedBuilder()
                .setTitle('🎉 Pack Opened!')
                .setDescription(`You pulled a **[${unlockedCard.rarity}]** card!\n\n**${unlockedCard.name}**\n*Perk: ${unlockedCard.perk}*`)
                .setImage(unlockedCard.image)
                .setColor(0xFFD700);

            return interaction.update({ content: '🎁 Successfully opened a saved pack from your inventory!', embeds: [cardEmbed], components: [] }).catch(() => {});
        }
        return;
    }
    // 2. Handle Slash Commands Separately
    if (interaction.isChatInputCommand()) {
        const { commandName, guildId } = interaction;

        if (commandName === 'inventory') {
            const userId = interaction.user.id;
            let invDb = { users: {} };
            if (fs.existsSync(INVENTORY_FILE)) {
                invDb = JSON.parse(fs.readFileSync(INVENTORY_FILE, 'utf8'));
            }
            const userInv = invDb.users[userId] || { coins: 0, inventory: [], unopened_packs: 0 };

            const scores = loadScores();
            const globalData = scores.global?.[userId] || { lifetimeCorrect: 0 };
            const totalCorrect = globalData.lifetimeCorrect || 0;

            const milestones = [0, 50, 100, 200, 500];
            let progressBar = "";
            let reachedNext = false;

            for (let i = 0; i < milestones.length; i++) {
                const m = milestones[i];
                if (totalCorrect >= m) {
                    progressBar += `✅ **[${m}]** ─── `;
                } else if (!reachedNext) {
                    progressBar += `📍 **[You: ${totalCorrect}]** ─── 🎯 **[Next: ${m}]**`;
                    reachedNext = true;
                    break;
                }
            }
            if (!reachedNext && totalCorrect >= 500) {
                progressBar += `🏆 **MAX MILESTONE COMPLETED! (500+)**`;
            }

            const invEmbed = new EmbedBuilder()
                .setColor(0x00FFCC)
                .setTitle(`🎒 ${interaction.user.username}'s Secure Cricket Profile`)
                .setDescription(`💰 **Cricket Avengers Coins:** ${userInv.coins}\n📦 **Unopened Packs:** ${userInv.unopened_packs || 0}\n\n` +
                    `📊 **Career Correct Answers:** ${totalCorrect}\n` +
                    `🎯 **Milestone Number Line:**\n${progressBar}`)
                .setFooter({ text: 'Milestones and inventory are bound securely to your Discord ID.' });

            const invRows = [];
            if ((userInv.unopened_packs || 0) > 0) {
                const openSavedRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`invopen_pack_${userId}`)
                        .setLabel(`🎁 Open Saved Pack (${userInv.unopened_packs} left)`)
                        .setStyle(ButtonStyle.Success)
                );
                invRows.push(openSavedRow);
            }

            return await interaction.reply({ embeds: [invEmbed], components: invRows, flags: 64 }).catch(() => {});
        }

       if (commandName === 'qotd') {
            await interaction.reply({ content: '🚀 Triggering QOTD with live countdown...', flags: 64 }).catch(() => {});
            await triggerAutomatedQotd(client, interaction.channel);
            return;
        }

        if (commandName === 'leaderboard') {
            const scores = loadScores();
            const guildScores = scores.guilds?.[guildId] || {};
            
            const sortedUsers = Object.entries(guildScores)
                .sort((a, b) => b[1].points - a[1].points)
                .slice(0, 10);

            if (sortedUsers.length === 0) {
                return await interaction.reply({ content: "🏆 No scores recorded in this server yet! Run `/quiz` to start playing.", flags: 64 }).catch(() => {});
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

            return await interaction.reply({ embeds: [lbEmbed] }).catch(() => {});
        }

        if (commandName === 'global-leaderboard') {
            const scores = loadScores();
            const globalScores = scores.global || {};
            
            const sortedUsers = Object.entries(globalScores)
                .sort((a, b) => b[1].points - a[1].points)
                .slice(0, 10);

            if (sortedUsers.length === 0) {
                return await interaction.reply({ content: "🏆 No global scores recorded yet! Run `/quiz` to start playing.", flags: 64 }).catch(() => {});
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

            return await interaction.reply({ embeds: [globalEmbed] }).catch(() => {});
        }
        
        if (commandName === 'quiz') {
            // Prevent multiple overlapping quizzes in the same channel
            if (global.activeQuizChannels && global.activeQuizChannels.has(interaction.channelId)) {
                return interaction.reply({ content: "⚠️ A multiplayer quiz match is already running in this channel! Please wait for it to finish.", flags: 64 });
            }

            if (!global.activeQuizChannels) global.activeQuizChannels = new Set();
            global.activeQuizChannels.add(interaction.channelId);

            try {
                await interaction.reply({ content: '🏏 **Starting Multiplayer Lobby...**', flags: 64 }).catch(() => {});

                const totalQuestions = interaction.options.getInteger('length');
                let hostId = interaction.user.id;
                const joinedPlayers = new Map();

                joinedPlayers.set(hostId, { username: interaction.user.username, score: 0, streak: 0 });

                const getLobbyRows = () => [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('join_lobby').setLabel('Join Lobby 🏏').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId('leave_lobby').setLabel('Leave Lobby 🚪').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId('start_now').setLabel('Start Now 🚀').setStyle(ButtonStyle.Primary)
                    ),
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('cancel_match').setLabel('Cancel Match ❌').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId('transfer_host').setLabel('Transfer Host 👑').setStyle(ButtonStyle.Secondary)
                    )
                ];

                let lobbyTimeLeft = 15;
                const lobbyEmbed = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle('🏏 Pure Cricket Match Lobby (Max 10 Players)')
                    .setDescription(`Hosted by <@${hostId}>\n\n**Players Joined (${joinedPlayers.size}/10):**\n` + 
                        Array.from(joinedPlayers.values()).map(p => `• ${p.username}`).join('\n') +
                        `\n\n⏱️ Match starts in **${lobbyTimeLeft}s** or when the host clicks Start Now!`)
                    .setFooter({ text: 'Get ready for synchronized questions!' });

                const lobbyMessage = await interaction.channel.send({ embeds: [lobbyEmbed], components: getLobbyRows() });

                const lobbyCollector = lobbyMessage.createMessageComponentCollector({ time: 15000 });
                let forceStart = false;
                let matchCancelled = false;

                lobbyCollector.on('collect', async i => {
                    if (i.customId === 'join_lobby') {
                        if (!joinedPlayers.has(i.user.id)) {
                            if (joinedPlayers.size >= 10) {
                                return i.reply({ content: "❌ Lobby is full! Maximum 10 players allowed.", flags: 64 });
                            }
                            joinedPlayers.set(i.user.id, { username: i.user.username, score: 0, streak: 0 });
                            await i.reply({ content: "✅ You have successfully joined the quiz lobby!", flags: 64 });
                        } else {
                            await i.reply({ content: "⚠️ You are already in the lobby!", flags: 64 });
                        }
                    }

                    if (i.customId === 'leave_lobby') {
                        if (i.user.id === hostId) {
                            return i.reply({ content: "❌ As the host, you cannot leave! Use **Cancel Match** or transfer host first.", flags: 64 });
                        }
                        if (joinedPlayers.has(i.user.id)) {
                            joinedPlayers.delete(i.user.id);
                            await i.reply({ content: "🚪 You have left the quiz lobby.", flags: 64 });
                        } else {
                            await i.reply({ content: "⚠️ You are not in the lobby!", flags: 64 });
                        }
                    }

                    if (i.customId === 'cancel_match') {
                        if (i.user.id !== hostId) {
                            return i.reply({ content: "❌ Only the host can cancel the match!", flags: 64 });
                        }
                        matchCancelled = true;
                        await i.deferUpdate().catch(() => {});
                        lobbyCollector.stop();
                        return;
                    }

                    if (i.customId === 'transfer_host') {
                        if (i.user.id !== hostId) {
                            return i.reply({ content: "❌ Only the current host can transfer host privileges!", flags: 64 });
                        }
                        const otherPlayers = Array.from(joinedPlayers.keys()).filter(id => id !== hostId);
                        if (otherPlayers.length === 0) {
                            return i.reply({ content: "❌ There are no other players in the lobby to transfer host to!", flags: 64 });
                        }
                        hostId = otherPlayers[0];
                        await i.reply({ content: `👑 Host privileges transferred to <@${hostId}>!`, flags: 64 });
                    }

                    const updatedDesc = `Hosted by <@${hostId}>\n\n**Players Joined (${joinedPlayers.size}/10):**\n` + 
                        Array.from(joinedPlayers.values()).map(p => `• ${p.username}`).join('\n') +
                        `\n\n⏱️ Match starts in **${lobbyTimeLeft}s** or when the host clicks Start Now!`;
                    
                    lobbyEmbed.setDescription(updatedDesc);
                    await lobbyMessage.edit({ embeds: [lobbyEmbed], components: getLobbyRows() }).catch(() => {});

                    if (i.customId === 'start_now') {
                        if (i.user.id !== hostId) {
                            return i.reply({ content: "❌ Only the host can start the quiz early!", flags: 64 });
                        }
                        forceStart = true;
                        await i.deferUpdate().catch(() => {});
                        lobbyCollector.stop();
                    }
                });

                for (let t = 14; t >= 1; t--) {
                    if (forceStart || matchCancelled) break;
                    await new Promise(r => setTimeout(r, 1000));
                    lobbyTimeLeft = t;
                    const updatedDesc = `Hosted by <@${hostId}>\n\n**Players Joined (${joinedPlayers.size}/10):**\n` + 
                        Array.from(joinedPlayers.values()).map(p => `• ${p.username}`).join('\n') +
                        `\n\n⏱️ Match starts in **${lobbyTimeLeft}s** or when the host clicks Start Now!`;
                    lobbyEmbed.setDescription(updatedDesc);
                    await lobbyMessage.edit({ embeds: [lobbyEmbed] }).catch(() => {});
                }

                lobbyCollector.stop();

                if (matchCancelled) {
                    const canceledRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('cancelled').setLabel('Match Cancelled ❌').setStyle(ButtonStyle.Danger).setDisabled(true)
                    );
                    await lobbyMessage.edit({ content: "❌ **Lobby cancelled by the host.**", components: [canceledRow] }).catch(() => {});
                    return;
                }

                const disabledJoinRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('join_lobby')
                        .setLabel('Lobby Closed 🔒')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId('start_now')
                        .setLabel('Started 🚀')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(true)
                );
                await lobbyMessage.edit({ content: "🚨 **Lobby closed! Fetching synchronized questions...**", components: [disabledJoinRow] }).catch(() => {});

                const questions = await getCricketQuestions(totalQuestions);

                // STRICTLY SEQUENTIAL QUESTION LOOP (Waits for each question to fully finish before posting the next one)
                for (let qIndex = 0; qIndex < questions.length; qIndex++) {
                    const q = questions[qIndex];
                    const correctIndex = q.answer;

                    const row = new ActionRowBuilder();
                    q.options.forEach((option, index) => {
                        row.addComponents(
                            new ButtonBuilder()
                                .setCustomId(`q_${qIndex}_${index}`)
                                .setLabel(`${String.fromCharCode(65 + index)}: ${option.substring(0, 65)}`)
                                .setStyle(ButtonStyle.Primary)
                        );
                    });

                    let qTimeLeft = 10;
                    const qEmbed = new EmbedBuilder()
                        .setColor(0x0099FF)
                        .setTitle(`🏏 Question ${qIndex + 1} of ${totalQuestions} (Multiplayer Match)`)
                        .setDescription(q.question + '\n\n*📝 Note: 0 for incorrect, +1 for correct, +2 for streak bonus!*')
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

                    // Wait for the full round to complete before proceeding to the next question
                    await new Promise(resolve => {
                        const roundCollector = questionMessage.createMessageComponentCollector({ time: 10000 });

                        roundCollector.on('collect', async i => {
                            // Ensure only 'q_' buttons for this round are handled
                            if (!i.customId.startsWith('q_')) return;

                            if (!joinedPlayers.has(i.user.id)) {
                                return i.reply({ content: "❌ You did not join this match lobby! Wait for the next round.", flags: 64 }).catch(() => {});
                            }

                            if (answeredUsers.has(i.user.id)) {
                                return i.reply({ content: "⚠️ You already answered this question!", flags: 64 }).catch(() => {});
                            }

                            await i.deferUpdate().catch(() => {});
                            answeredUsers.add(i.user.id);

                            const selectedIndex = parseInt(i.customId.split('_')[2]);
                            const player = joinedPlayers.get(i.user.id);

                            if (selectedIndex === correctIndex) {
                                player.streak += 1;
                                let earned = 1;
                                let streakMsg = "";
                                if (player.streak > 2) {
                                    earned += 2; 
                                    streakMsg = ` 🔥 (${player.streak}x Streak! +2 bonus pts)`;
                                }

                                player.score += earned;

                                const scores = loadScores();
                                if (!scores.global) scores.global = {};
                                if (!scores.guilds) scores.guilds = {};
                                if (!scores.guilds[guildId]) scores.guilds[guildId] = {};
                                
                                if (!scores.global[i.user.id]) {
                                    scores.global[i.user.id] = { username: i.user.username, points: 0, lifetimeCorrect: 0, claimedMilestones: [] };
                                }
                                if (!scores.guilds[guildId][i.user.id]) {
                                    scores.guilds[guildId][i.user.id] = { username: i.user.username, points: 0 };
                                }

                                scores.global[i.user.id].points += earned;
                                scores.guilds[guildId][i.user.id].points += earned;
                                
                                if (!scores.global[i.user.id].lifetimeCorrect) scores.global[i.user.id].lifetimeCorrect = 0;
                                scores.global[i.user.id].lifetimeCorrect += 1;

                                saveScores(scores);

                                await i.followUp({ content: `🎉 **Correct Answer** (+${earned} pts).${streakMsg}`, flags: 64 }).catch(() => {});
                            } else {
                                player.streak = 0;
                                await i.followUp({ content: `❌ **Incorrect Answer**! The correct answer was **${q.options[correctIndex]}**. Streak reset.`, flags: 64 }).catch(() => {});
                            }
                        });

                        roundCollector.on('end', async () => {
                            clearInterval(qInterval);

                            const disabledQRow = new ActionRowBuilder();
                            q.options.forEach((option, index) => {
                                let style = ButtonStyle.Secondary;
                                if (index === correctIndex) style = ButtonStyle.Success;
                                disabledQRow.addComponents(
                                    new ButtonBuilder()
                                        .setCustomId(`dis_${index}`)
                                        .setLabel(`${String.fromCharCode(65 + index)}: ${option.substring(0, 65)}`)
                                        .setStyle(style)
                                        .setDisabled(true)
                                );
                            });

                            await questionMessage.edit({
                                content: `🔒 **Time's up for Question ${qIndex + 1}!** Correct Answer: **${q.options[correctIndex]}**`,
                                components: [disabledQRow]
                            }).catch(() => {});

                            setTimeout(resolve, 2000); // Wait 2 seconds before moving to the next question
                        });
                    });
                }

                const sortedMatchPlayers = Array.from(joinedPlayers.entries()).sort((a, b) => b[1].score - a[1].score);
                let summaryDesc = sortedMatchPlayers.map(([userId, p], idx) => {
                    const medal = idx === 0 ? '🏆' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;
                    return `${medal} **${p.username}** — **${p.score} points**`;
                }).join('\n');

                const summaryEmbed = new EmbedBuilder()
                    .setColor(0xFFD700)
                    .setTitle('🏁 Multiplayer Match Complete!')
                    .setDescription(`Here are the final standings for this session:\n\n${summaryDesc}`)
                    .setFooter({ text: 'Check overall standings using /leaderboard or /global-leaderboard' });

                await interaction.channel.send({ embeds: [summaryEmbed] });

                const SCORE_THRESHOLD = totalQuestions === 5 ? 3 : 7;
                const eligibleWinners = sortedMatchPlayers.filter(([userId, data]) => data.score >= SCORE_THRESHOLD);

                if (eligibleWinners.length > 0) {
                    let invDb = { users: {} };
                    if (fs.existsSync(INVENTORY_FILE)) {
                        invDb = JSON.parse(fs.readFileSync(INVENTORY_FILE, 'utf8'));
                    }

                    for (const [winnerId, winnerData] of eligibleWinners) {
                        if (!invDb.users[winnerId]) {
                            invDb.users[winnerId] = { coins: 0, inventory: [], unopened_packs: 0 };
                        }
                        if (!invDb.users[winnerId].unopened_packs) {
                            invDb.users[winnerId].unopened_packs = 0;
                        }

                        // Automatically add pack to inventory
                        invDb.users[winnerId].unopened_packs += 1;

                        const packEmbed = new EmbedBuilder()
                            .setColor(0x00FFCC)
                            .setTitle('🎁 Match Reward Automatically Saved!')
                            .setDescription(`Congratulations <@${winnerId}>! You scored **${winnerData.score} points** (meeting the threshold).\n\n🎒 **1x Cricket Player Pack** has been automatically saved to your inventory! Use \`/inventory\` to open it anytime.`);

                        await interaction.channel.send({ content: `<@${winnerId}>`, embeds: [packEmbed] });
                    }

                    fs.writeFileSync(INVENTORY_FILE, JSON.stringify(invDb, null, 2));
                }
            } finally {
                // Always release the channel lock when finished
                global.activeQuizChannels.delete(interaction.channelId);
            }
        }
    }
});

client.login(process.env.DISCORD_TOKEN);