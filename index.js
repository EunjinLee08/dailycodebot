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
async function reportMissedCheckins(dateString) {
  const guild = client.guilds.cache.first(); // 단일 서버 기준
  const allMembers = await guild.members.fetch();
  const certified = await getCertifiedUsers(dateString); // 해당 날짜 인증자 리스트

  const missed = allMembers
    .filter(m => !m.user.bot && !certified.includes(m.id))
    .map(m => `<@${m.id}>`);

  if (missed.length > 0) {
    const channel = await client.channels.fetch(process.env.NOTICE_CHANNEL_ID);
    await channel.send(`❗ ${dateString} 인증 누락자:\n${missed.join(', ')}`);
  } else {
    const channel = await client.channels.fetch(process.env.NOTICE_CHANNEL_ID);
    await channel.send(`✅ ${dateString}에 모든 사용자가 인증했습니다.`);
  }
}

cron.schedule('59 23 * * *', async () => {
  const now = new Date();
  const today = now.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }).replace('. ', '/').replace('.', '');
  await reportMissedCheckins(today);
});


client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // 누락자 수동 확인 커맨드: !누락자 06/23
  if (message.content.startsWith('!누락자')) {
    const args = message.content.split(' ');
    if (args.length !== 2) {
      return message.reply('❌ 사용법: `!누락자 MM/DD`');
    }

    const dateRegex = /^\d{2}\/\d{2}$/;
    if (!dateRegex.test(args[1])) {
      return message.reply('❌ 날짜 형식이 잘못되었습니다. 예: 06/23');
    }

    await reportMissedCheckins(args[1]);
  }
});

// 주차별 정산
function getWeekDates(includedDateStr) {
  const [month, day] = includedDateStr.split('/').map(Number);
  const baseDate = new Date(new Date().getFullYear(), month - 1, day);
  const dayOfWeek = baseDate.getDay();
  const monday = new Date(baseDate);
  monday.setDate(baseDate.getDate() - ((dayOfWeek + 6) % 7));

  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const mmdd = d.toLocaleDateString('ko-KR', {month: '2-digit', day: '2-digit'}).replace('. ', '-').replace('.', '');
    dates.push(mmdd);
  }
  return dates;
}

// 주간 누락자 수동 확인 커맨드
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.content.startsWith('!주간누락')) {
    const args = message.content.split(' ');
    if (args.length !== 2) {
      return message.reply('사용법: `!주간누락 MM/DD`');
    }

    const dateRegex = /^\d{2}\/\d{2}$/;
    if (!dateRegex.test(args[1])) {
      return message.reply('날짜 형식이 잘못되었습니다. 예: 06/23');
    }

    const weekDates = getWeekDates(args[1]);
    const guild = client.guilds.cache.first();
    const allMembers = await guild.members.fetch();
    const results = {};

    for (const [id, member] of allMembers) {
      if (member.user.bot) continue;
      results[id] = 0;
    }

    for (const date of weekDates) {
      const certified = await getCertifiedUsers(date);
      for (const [id, member] of allMembers) {
        if (member.user.bot) continue;
        if (!certified.includes(id)) {
          results[id]++;
        }
      }
    }

    const lines = Object.entries(results).filter(([_, count]) => count > 0).map(([id, count]) => `<@${id}>: ${count}회 누락`);

    const report = lines.length > 0 ? `${args[1]}이 포함된 주간 누락 현황:\n${lines.join('\n')}`: `${args[1]}이 포함된 주간 누락 현황: 전원 제출`;

    const targetChannel = await client.channels.fetch("1391068987412054037");
    await targetChannel.send(report);
  }
});

// 누적 벌금 확인
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.content.trim() === '!누적벌금') {
    const START_DATE = new Date("2025-06-23");
    const now = new Date();
    now.setDate(now.getDate() - 1); //  어제 기준으로 정산

    const dates = [];
    const current = new Date(START_DATE);

    while (current <= now) {
      const mmdd = current.toLocaleDateString('ko-KR', {month: '2-digit', day: '2-digit'}).replace('. ', '-').replace('.', '');
      dates.push(mmdd);
      current.setDate(current.getDate() + 1);
    }

    const guild = client.guilds.cache.first();
    const allMembers = await guild.members.fetch();
    const results = {};

    for (const [id, member] of allMembers) {
      if (member.user.bot) continue;
      results[id] = 0;
    }

    for (const date of dates) {
      const certified = await getCertifiedUsers(date);
      for (const [id, member] of allMembers) {
        if (member.user.bot) continue;
        if (!certified.includes(id)) {
          results[id]++;
        }
      }
    }

    const lines = Object.entries(results).filter(([_, count]) => count > 0).map(([id, count]) => `<@${id}>: ${count * 500}원`);

    const report = lines.length > 0 ? `누적 벌금 현황 (기준일: 2025/06/23 ~ 오늘):\n${lines.join('\n')}` : `기준일 이후 전원 인증 완료`;

    const targetChannel = await client.channels.fetch("1391068987412054037");
    await targetChannel.send(report);
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
