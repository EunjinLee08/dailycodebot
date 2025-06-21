import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';
import { saveCheckin, getCertifiedUsers } from './services/checkinService.js';
import cron from 'node-cron';
import express from 'express';

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// 인증 감지
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.channel.isThread()) return;

  const parentId = process.env.PARENT_CHANNEL_ID;
  if (message.channel.parentId !== parentId) return;

  const date = message.channel.name; // ex. "06/23"
  const dateRegex = /^\d{2}\/\d{2}$/;
  if (!dateRegex.test(date)) return;

  await saveCheckin(message.author.id, date);
  await message.react('✅');
});

// 자정마다 누락자 알림
cron.schedule('59 23 * * *', async () => {
  const now = new Date();
  const today = now.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }).replace('. ', '/').replace('.', '');

  const guild = client.guilds.cache.first(); // 단일 서버 기준
  const allMembers = await guild.members.fetch();
  const certified = await getCertifiedUsers(today);

  const missed = allMembers
    .filter(m => !m.user.bot && !certified.includes(m.id))
    .map(m => `<@${m.id}>`);

  if (missed.length > 0) {
    const channel = await client.channels.fetch(process.env.NOTICE_CHANNEL_ID);
    channel.send(`❗ ${today} 인증 누락자:\n${missed.join(', ')}`);
  }
});

client.login(process.env.DISCORD_TOKEN);

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Bot is running!');
});

app.listen(PORT, () => {
  console.log(`Web server running on port ${PORT}`);
});
