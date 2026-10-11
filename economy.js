const fs = require('fs');

// Load card database
const rawData = fs.readFileSync('./cards.json');
const cardDB = JSON.parse(rawData).cards;

// Load or initialize user inventory database
function getUserData(userId) {
  let db = { users: {} };
  if (fs.existsSync('./user_inventory.json')) {
    db = JSON.parse(fs.readFileSync('./user_inventory.json'));
  }
  if (!db.users[userId]) {
    db.users[userId] = { coins: 0, inventory: [], active_card: null };
  }
  return db;
}

function saveUserData(db) {
  fs.writeFileSync('./user_inventory.json', JSON.stringify(db, null, 2));
}

// Roll for a random card based on rarity weights
function dropCardReward(userId) {
  const rand = Math.random() * 100;
  let selectedRarity = 'Common';
  
  if (rand <= 2) selectedRarity = 'Legendary';       // 2% chance
  else if (rand <= 10) selectedRarity = 'Epic';      // 8% chance
  else if (rand <= 30) selectedRarity = 'Rare';      // 20% chance

  // Filter cards by rolled rarity
  const eligibleCards = cardDB.filter(c => c.rarity === selectedRarity);
  const randomCard = eligibleCards[Math.floor(Math.random() * eligibleCards.length)];

  // Update user inventory
  const db = getUserData(userId);
  db.users[userId].coins += 50; // Reward base coins
  db.users[userId].inventory.push(randomCard.id);
  saveUserData(db);

  return randomCard;
}

module.exports = { dropCardReward };