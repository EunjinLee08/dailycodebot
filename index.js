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

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await processMissedMessages();
});

// 인증 감지 (실시간)
client.on('messageCreate', async (message) => {
  if (shouldProcessMessage(message)) {
    const date = message.channel.name;
    await saveCheckin(message.author.id, date);
    await message.react('✅');
  }
});

// 🔄 봇 실행 시 과거 메시지 처리
async function processMissedMessages() {
  const parentId = process.env.PARENT_CHANNEL_ID;
  const parentChannel = await client.channels.fetch(parentId);

  if (!parentChannel || !parentChannel.threads) {
    console.error('❌ 부모 채널을 찾을 수 없습니다.');
    return;
  }

  const threads = await parentChannel.threads.fetchActive();

  for (const [_, thread] of threads.threads) {
    const date = thread.name;
    const dateRegex = /^\d{2}\/\d{2}$/;
    if (!dateRegex.test(date)) continue;

    const messages = await thread.messages.fetch({ limit: 100 }); // 필요한 경우 더 많이 가져오기
    for (const [_, msg] of messages) {
      if (msg.author.bot) continue;

      const alreadyChecked = msg.reactions.cache.some(reaction => reaction.emoji.name === '✅' && reaction.me);
      const hasImage = msg.attachments.some(att => 
        att.contentType?.startsWith('image/')
      );

      if (!alreadyChecked && hasImage) {
        await saveCheckin(msg.author.id, date);
        await msg.react('✅');
      }
    }
  }
}

// 메시지 인증 조건
function shouldProcessMessage(message) {
  if (message.author.bot) return false;
  if (!message.channel.isThread()) return false;

  const parentId = process.env.PARENT_CHANNEL_ID;
  if (message.channel.parentId !== parentId) return false;

  const date = message.channel.name;
  const dateRegex = /^\d{2}\/\d{2}$/;
  if (!dateRegex.test(date)) return false;

  // ✅ 이미지 첨부 여부 확인
  const hasImage = message.attachments.some(attachment =>
    attachment.contentType?.startsWith('image/')
  );
  if (!hasImage) return false;

  return true;
}


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
