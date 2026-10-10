# Cricket Quiz Discord Bot

A production-ready, real-time multiplayer Discord bot built with Node.js, featuring dynamic AI-generated cricket trivia powered by Groq AI, local fallback question databases, individual streak tracking, and dual leaderboards.

---

## Features

* **Multiplayer Lobbies:** A 15-second interactive lobby phase allowing multiple users to join a match and compete simultaneously.
* **Synchronized Questions:** Every joined player receives the exact same set of questions at the same time.
* **Hybrid Question Architecture:** Uses Groq AI (`openai/gpt-oss-20b`) for live, limitless dynamic trivia generation with a reliable local JSON fallback.
* **Streak & Bonus Scoring:** Track session streaks. Getting 3 or more questions right in a row triggers bonus multiplier points.
* **Dual Leaderboards:** Compete for supremacy with server-specific (`/leaderboard`) and worldwide (`/global-leaderboard`) rankings.

---

## Slash Commands

* `/quiz [length]` — Start a multiplayer cricket trivia match lobby (Choose 5 or 10 questions).
* `/leaderboard` — View the top cricket experts in the current Discord server.
* `/global-leaderboard` — View the top players across all worldwide servers.

---

## Tech Stack

* Node.js & Discord.js (v14)
* Groq SDK (AI Question Generation)
* dotenv (Environment Security)
* File System (`fs`) (Persistent JSON Leaderboard Storage)

---

## Local Installation & Setup

1. **Clone the repository:**
```bash
git clone https://github.com/Ronak-malpani/Cricket_Quiz.git
cd Cricket_Quiz

```


2. **Install dependencies:**
```bash
npm install

```


3. **Configure Environment Variables:**
Create a `.env` file in the root directory and add your keys:
```env
DISCORD_TOKEN=your_discord_bot_token_here
GROQ_API_KEY=your_groq_api_key_here

```


4. **Run the bot:**
```bash
node index.js

```