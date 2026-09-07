import * as character from './character.js';
import * as gear from './gear.js';
import * as expedition from './expedition.js';
import * as bid from './bid.js';
import * as island from './island.js';
import * as market from './market.js';
import * as gem from './gem.js';
import * as help from './help.js';
import * as equip from './equip.js';
import * as accessory from './accessory.js';
import * as stone from './stone.js';
import * as bracelet from './bracelet.js';
import * as skills from './skills.js';
import * as arkpassive from './arkpassive.js';
import * as arkgrid from './arkgrid.js';
import * as avatar from './avatar.js';
import * as collectible from './collectible.js';
import * as power from './power.js';
import * as emoticon from './emoticon.js';
import * as gemsof from './gemsof.js';
import * as gemboard from './gemboard.js';
import * as engraving from './engraving.js';
import * as engravingRank from './engraving-rank.js';
import * as engravingRankRelic from './engraving-rank-relic.js';
import * as engravingRankLegend from './engraving-rank-legend.js';
import * as info from './info.js';
import * as crit from './crit.js';
import * as dealshare from './dealshare.js';
import * as dealcut from './dealcut.js';
import * as life from './life.js';
import * as events from './events.js';
import * as notices from './notices.js';
import * as raidgold from './raidgold.js';
import * as weekly from './weekly.js';
import * as synergy from './synergy.js';
import * as tankiness from './tankiness.js';
import * as hell from './hell.js';
import * as naraka from './naraka.js';
import * as efficiency from './efficiency.js';
import * as grinding from './grinding.js';
import * as cores from './cores.js';
import * as paradise from './paradise.js';
import * as skillcode from './skillcode.js';
import * as guardian from './guardian.js';
import * as alarm from './alarm.js';
import * as register from './register.js';
import * as lopec from './lopec.js';
import * as alt from './alt.js';
import * as gemEfficiency from './gem-efficiency.js';
import * as update from './update.js';
import * as cpm from './cpm.js';
import * as ranking from './ranking.js';
import * as tier from './tier.js';
import * as specup from './specup.js';
import * as rice from './rice.js';
import * as crystal from './crystal.js';
import * as merchant from './merchant.js';
import * as braceletSearch from './bracelet-search.js';
import * as attendance from './attendance.js';
import * as quip from './quip.js';

const base = [
  character, info, gear, expedition, bid, island, market, gem, help,
  equip, accessory, stone, bracelet, skills, arkpassive, arkgrid,
  avatar, collectible, power, crit, emoticon,
  gemsof, gemboard, engraving, engravingRank, engravingRankRelic, engravingRankLegend,
  life, events, notices,
  raidgold, weekly, synergy, tankiness, hell, naraka, efficiency, dealshare, dealcut,
  grinding, cores, paradise, skillcode, guardian, alarm, register, lopec, alt, gemEfficiency, update, cpm, ranking, tier, specup, rice, crystal, merchant, braceletSearch, attendance, quip,
];

// 슬래시 등록과 디스코드 실행은 기본 명령만 사용한다. 출첵·한마디는 카톡 전용이다.
export const commands = base.filter((command) => !['출첵', '한마디'].includes(command.data.name));

// 카톡의 단어·초성 별칭은 기존 텍스트 파서가 기본 명령 이름으로 풀어 실행한다.
export const kakaoCommands = base;
