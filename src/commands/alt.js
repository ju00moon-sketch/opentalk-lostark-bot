import { SlashCommandBuilder } from 'discord.js';
import { execute as expedition } from './expedition.js';

// /원정대와 같은 내용 — 부캐를 찾는 맥락에서 더 자연스러운 이름이라 별도 커맨드로 둔다.
export const data = new SlashCommandBuilder()
  .setName('부캐')
  .setDescription('같은 계정의 모든 캐릭터를 아이템 레벨 순으로 보여줍니다')
  .addStringOption((option) =>
    option.setName('닉네임').setDescription('원정대 내 아무 캐릭터 닉네임 (비우면 /등록한 내 캐릭터)'),
  );

export const execute = expedition;
